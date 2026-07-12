// `pnpm run release` entrypoint: bump the semver everywhere, then build and
// verify the signed Android release, then collect the built APK(s) into
// `build/` as `RemindMe_v{version}_{arch}.apk`. A single Node entrypoint
// (rather than a chained npm script) is what lets `pnpm run release --patch`
// forward the increment flag to the bump step — pnpm appends extra args to the
// *end* of a compound script, which would attach them to the wrong command.
//
//   pnpm run release              # default: minor bump, then build + verify
//   pnpm run release --patch      # patch bump
//   pnpm run release --major      # major bump
//   pnpm run release --skip-semver  # build + verify without touching the version
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, renameSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { bumpVersion } from './bump-version.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Gradle emits one directory per build flavor (universal, arm64, ...), so the
// directory name under here *is* the architecture label for the artifact.
const APK_OUT = join(ROOT, 'src-tauri/gen/android/app/build/outputs/apk');
const BUILD_DIR = join(ROOT, 'build');

const args = process.argv.slice(2);

let version;
try {
  ({ to: version } = await bumpVersion(args));
} catch (err) {
  console.error(`release: ${err.message}`);
  throw err;
}

function run(script) {
  console.log(`\n$ pnpm run ${script}`);
  execSync(`pnpm run ${script}`, { stdio: 'inherit' });
}

/**
 * Renames every APK produced by this build to `RemindMe_v{version}_{arch}.apk`
 * and moves it into `build/`. Only APKs written at or after `since` (the start
 * of the build step) are collected, so a stale artifact left in a different
 * flavor directory by an earlier build can't be mislabeled with this version.
 */
function collectApks(since) {
  mkdirSync(BUILD_DIR, { recursive: true });

  const moved = [];
  for (const arch of readdirSync(APK_OUT)) {
    const releaseDir = join(APK_OUT, arch, 'release');
    if (!existsSync(releaseDir)) continue;

    const fresh = readdirSync(releaseDir)
      .filter((f) => f.endsWith('.apk') && statSync(join(releaseDir, f)).mtimeMs >= since);
    if (fresh.length === 0) continue;
    if (fresh.length > 1) {
      throw new Error(`Found ${fresh.length} fresh APKs in ${releaseDir} (${fresh.join(', ')}); expected one per architecture.`);
    }

    const dest = join(BUILD_DIR, `RemindMe_v${version}_${arch}.apk`);
    renameSync(join(releaseDir, fresh[0]), dest);
    moved.push(dest);
  }

  if (moved.length === 0) {
    throw new Error(`No freshly built release APKs found under ${relative(ROOT, APK_OUT)}.`);
  }
  console.log('');
  for (const apk of moved) {
    console.log(`  ✓ ${relative(ROOT, apk)}`);
  }
}

const buildStart = Date.now();
run('release:build');
// Verify before moving: release:verify points at the Gradle output path.
run('release:verify');
collectApks(buildStart);
