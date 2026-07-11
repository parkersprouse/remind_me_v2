// `pnpm run release` entrypoint: bump the semver everywhere, then build and
// verify the signed Android release. A single Node entrypoint (rather than a
// chained npm script) is what lets `pnpm run release --patch` forward the
// increment flag to the bump step — pnpm appends extra args to the *end* of a
// compound script, which would attach them to the wrong command.
//
//   pnpm run release              # default: minor bump, then build + verify
//   pnpm run release --patch      # patch bump
//   pnpm run release --major      # major bump
//   pnpm run release --skip-semver  # build + verify without touching the version

import { execSync } from 'node:child_process';
import { bumpVersion } from './bump-version.mjs';

const args = process.argv.slice(2);

try {
  await bumpVersion(args);
} catch (err) {
  console.error(`release: ${err.message}`);
  process.exit(1);
}

const run = (script) => {
  console.log(`\n$ pnpm run ${script}`);
  execSync(`pnpm run ${script}`, { stdio: 'inherit' });
};

run('release:build');
run('release:verify');
