// Bumps the application's semver in every tracked file that hard-codes it, so a
// release only has to name the increment kind. The Android `versionName` /
// `versionCode` are NOT edited here: Tauri derives them from
// `src-tauri/tauri.conf.json` `version` on the next `tauri android build`
// (see RELEASE.md), so keeping tauri.conf.json in sync covers Android too.
//
// Usage (standalone):  node scripts/bump-version.mjs [--major|--minor|--patch|--skip-semver]
// Default (no flag):   --minor
//
// `tauri.conf.json` is the canonical source for the current version; the other
// files are synced to it, which also heals any drift between them.

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const CANONICAL = 'src-tauri/tauri.conf.json';

// Every file that hard-codes the version, with the regex that isolates it.
// Each pattern captures the version in group 1 so it can be read and swapped
// without disturbing surrounding formatting or unrelated version fields
// (e.g. dependency versions in Cargo.toml / package.json).
const TARGETS = [
  // package.json: the sole top-level `"version"` key (deps use `"name": "^x"`).
  { file: 'package.json', pattern: /("version":\s*")(\d+\.\d+\.\d+)(")/ },
  // tauri.conf.json: single `"version"` key.
  { file: 'src-tauri/tauri.conf.json', pattern: /("version":\s*")(\d+\.\d+\.\d+)(")/ },
  // Cargo.toml: the [package] `version` — the only line-start `version = "..."`
  // (dependency versions are inline `{ version = "..." }`, never line-start).
  { file: 'src-tauri/Cargo.toml', pattern: /(^version = ")(\d+\.\d+\.\d+)(")/m },
  // Cargo.lock: the remind_me package entry.
  { file: 'src-tauri/Cargo.lock', pattern: /(name = "remind_me"\nversion = ")(\d+\.\d+\.\d+)(")/ },
];

export function parseArgs(argv) {
  const flags = new Set(argv);
  const bumpFlags = ['--major', '--minor', '--patch'].filter((f) => flags.has(f));
  const skip = flags.has('--skip-semver');

  if (bumpFlags.length > 1) {
    throw new Error(`Conflicting flags: ${bumpFlags.join(', ')}. Pass at most one of --major, --minor, --patch.`);
  }
  // Default to a minor bump when no increment flag is given.
  const kind = bumpFlags[0]?.replace('--', '') ?? 'minor';
  return { skip, kind };
}

export function nextVersion(current, kind) {
  const parts = current.split('.').map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isInteger(n) || n < 0)) {
    throw new Error(`Cannot parse semver "${current}".`);
  }
  let [major, minor, patch] = parts;
  switch (kind) {
    case 'major': major += 1; minor = 0; patch = 0; break;
    case 'minor': minor += 1; patch = 0; break;
    case 'patch': patch += 1; break;
    default: throw new Error(`Unknown bump kind "${kind}".`);
  }
  return `${major}.${minor}.${patch}`;
}

async function readVersion(target) {
  const text = await readFile(resolve(ROOT, target.file), 'utf8');
  const match = text.match(target.pattern);
  if (!match) {
    throw new Error(`Could not find a version in ${target.file}.`);
  }
  return { text, current: match[2] };
}

/**
 * Bumps (or, with --skip-semver, leaves) the version in every target file.
 * Returns { skipped, from, to } describing what happened.
 */
export async function bumpVersion(argv = []) {
  const { skip, kind } = parseArgs(argv);

  // The canonical file decides the version everything else is synced to.
  const canonicalTarget = TARGETS.find((t) => t.file === CANONICAL);
  const { current } = await readVersion(canonicalTarget);

  if (skip) {
    console.log(`Skipping semver bump (--skip-semver). Version stays at ${current}.`);
    return { skipped: true, from: current, to: current };
  }

  const next = nextVersion(current, kind);

  for (const target of TARGETS) {
    const { text, current: found } = await readVersion(target);
    if (found !== current) {
      console.warn(`  ! ${target.file} was at ${found} (expected ${current}); syncing to ${next}.`);
    }
    const updated = text.replace(target.pattern, `$1${next}$3`);
    await writeFile(resolve(ROOT, target.file), updated);
    console.log(`  ✓ ${target.file}: ${found} → ${next}`);
  }

  console.log(`\nBumped ${kind} version: ${current} → ${next}`);
  console.log('Android versionName/versionCode will follow from tauri.conf.json on the next build.');
  return { skipped: false, from: current, to: next };
}

// Run as a CLI when invoked directly (not when imported by release.mjs).
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  bumpVersion(process.argv.slice(2)).catch((err) => {
    console.error(`bump-version: ${err.message}`);
    process.exit(1);
  });
}
