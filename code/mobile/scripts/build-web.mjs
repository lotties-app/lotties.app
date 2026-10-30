// Builds the web app for the native shell (`npm --prefix ../web run build:native`) stamped with the app's version, so
// Hub > About in a store build shows its real release instead of "dev" (docs/DEPLOY.md "Versions").
// APP_VERSION wins; else LOTTIES_VERSION_NAME (the release workflow's resolved version); else this package's version.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const own = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
const version = process.env.APP_VERSION?.trim() || process.env.LOTTIES_VERSION_NAME?.trim() || own;
console.log(`Building the web app for the native shell as version ${version}`);

const result = spawnSync('npm', ['--prefix', '../web', 'run', 'build:native'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...process.env, APP_VERSION: version },
});
process.exit(result.status ?? 1);
