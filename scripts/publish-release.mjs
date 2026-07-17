// `pnpm run publish` entrypoint: creates a GitHub Release for the version
// currently sitting in `src-tauri/tauri.conf.json`, tagging it, uploading
// every APK/AAB built for that version in `build/`, and writing a changelog
// body from the commits since the previous release.
//
// Deliberately NOT chained into `pnpm run release` — cutting a release build
// and publishing it as a public, effectively-immutable GitHub Release are
// separate decisions, and the latter should always be a conscious, separate
// step. The semver check below is done manually (rather than relying solely
// on GitHub rejecting a duplicate tag) so the guard survives even if the
// repo's release-immutability rules ever change.
//
//   pnpm run publish                     # tag/title default to v{version}
//   pnpm run publish -t "Cool title"      # custom release title
//   pnpm run publish --tag v1.3.0-rc1     # custom tag name
//   pnpm run publish --dry-run            # resolve + print everything, publish nothing

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BUILD_DIR = join(ROOT, 'build');
const TAURI_CONF = join(ROOT, 'src-tauri/tauri.conf.json');

// The spec asks for this literal handle on every changelog entry, regardless
// of who actually authored the commit.
const RELEASE_AUTHOR = 'parkersprouse';

function sh(cmd, args) {
  return execFileSync(cmd, args, { cwd: ROOT, encoding: 'utf8' }).trim();
}

function parseArgs(argv) {
  let title;
  let tag;
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-t' || arg === '--title') title = argv[++i];
    else if (arg === '--tag') tag = argv[++i];
    else if (arg === '--dry-run') dryRun = true;
    else throw new Error(`Unknown argument "${arg}".`);
  }
  return { title, tag, dryRun };
}

function currentVersion() {
  const raw = readFileSync(TAURI_CONF, 'utf8');
  const match = raw.match(/"version":\s*"(\d+\.\d+\.\d+)"/);
  if (!match) throw new Error(`Could not find "version" in ${relative(ROOT, TAURI_CONF)}.`);
  return match[1];
}

/** Returns the tag of the latest (non-draft, non-prerelease) GitHub release, or null if the repo has none yet. */
function latestReleaseTag(repo) {
  try {
    return sh('gh', ['release', 'view', '--repo', repo, '--json', 'tagName', '-q', '.tagName']);
  } catch (err) {
    const stderr = err.stderr?.toString() ?? err.message;
    if (/release not found/i.test(stderr)) return null;
    throw err;
  }
}

/** Every APK/AAB in build/ that was built for this exact version. */
function collectAssets(version) {
  if (!existsSync(BUILD_DIR)) {
    throw new Error(`No ${relative(ROOT, BUILD_DIR)} directory found. Run \`pnpm run release\` first.`);
  }
  const files = readdirSync(BUILD_DIR)
    .filter((f) => /\.(apk|aab)$/i.test(f) && f.includes(`_v${version}_`))
    .map((f) => join(BUILD_DIR, f));
  if (files.length === 0) {
    throw new Error(`No APK/AAB files for v${version} found in ${relative(ROOT, BUILD_DIR)}. Run \`pnpm run release\` first.`);
  }
  return files;
}

/**
 * Builds the "## What's Changed" body from the commits between the previous
 * release and HEAD (or, if this is the first-ever release, from the start of
 * history). The version-bump commit (message === the bare tag it produced,
 * e.g. "v1.3.0") is filtered out as noise, since it's not a user-facing change.
 */
function changelogBody(repo, previousTag) {
  const range = previousTag ? `${previousTag}..HEAD` : 'HEAD';
  let log;
  try {
    log = sh('git', ['log', range, '--no-merges', '--reverse', '--format=%H%x1f%s']);
  } catch (err) {
    throw new Error(`Could not read commit history for range "${range}" (is tag ${previousTag} fetched locally? try \`git fetch --tags\`).\n${err.message}`);
  }

  const entries = log
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [sha, subject] = line.split('\x1f');
      return { sha, subject };
    })
    .filter(({ subject }) => !/^v\d+\.\d+\.\d+$/.test(subject.trim()))
    .map(({ sha, subject }) => `* [${subject}](https://github.com/${repo}/commit/${sha}) by @${RELEASE_AUTHOR}`);

  return ['## What\'s Changed', ...entries].join('\n');
}

function main() {
  const { title, tag, dryRun } = parseArgs(process.argv.slice(2));

  const status = sh('git', ['status', '--porcelain']);
  if (status) {
    console.warn('publish: warning — working tree has uncommitted changes; the release tag will point at HEAD, which may not include them.');
  }

  const repo = sh('gh', ['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner']);
  const version = currentVersion();
  const previousTag = latestReleaseTag(repo);

  if (previousTag && previousTag.replace(/^v/, '') === version) {
    throw new Error(`v${version} is already published as ${previousTag} on GitHub. Run \`pnpm run release\` to cut a new version before publishing.`);
  }

  const resolvedTag = tag ?? `v${version}`;
  const resolvedTitle = title ?? `v${version}`;
  const assets = collectAssets(version);
  const notes = changelogBody(repo, previousTag);
  const targetSha = sh('git', ['rev-parse', 'HEAD']);

  console.log(`Repo:            ${repo}`);
  console.log(`Previous release: ${previousTag ?? '(none)'}`);
  console.log(`New tag:         ${resolvedTag} @ ${targetSha}`);
  console.log(`Title:           ${resolvedTitle}`);
  console.log('Assets:');
  for (const asset of assets) console.log(`  - ${relative(ROOT, asset)}`);
  console.log('\nNotes:\n' + notes + '\n');

  if (dryRun) {
    console.log('(dry run — no release was created)');
    return;
  }

  const notesDir = mkdtempSync(join(tmpdir(), 'remind-me-release-'));
  const notesPath = join(notesDir, 'notes.md');
  writeFileSync(notesPath, notes);
  try {
    execFileSync('gh', [
      'release', 'create', resolvedTag,
      ...assets,
      '--repo', repo,
      '--title', resolvedTitle,
      '--target', targetSha,
      '--notes-file', notesPath,
    ], { cwd: ROOT, stdio: 'inherit' });
  } finally {
    rmSync(notesDir, { recursive: true, force: true });
  }
}

try {
  main();
} catch (err) {
  console.error(`publish: ${err.message}`);
  process.exit(1);
}
