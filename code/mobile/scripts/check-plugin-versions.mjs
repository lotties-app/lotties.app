// The web build bundles the JavaScript side of the Capacitor plugins (code/web/node_modules) and the native projects
// compile their native side (code/mobile/node_modules). Both sides of a plugin must be the same version, so every
// @capacitor/* package declared in both package.json files must be pinned to the same exact version.
// Run: npm run check:versions (also part of npm run sync).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (relative) =>
  JSON.parse(readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8'));

const capacitorDeps = (manifest) =>
  Object.entries({ ...manifest.dependencies, ...manifest.devDependencies }).filter(([name]) =>
    name.startsWith('@capacitor/'),
  );

const mobile = new Map(capacitorDeps(read('../package.json')));
const web = capacitorDeps(read('../../web/package.json'));

const problems = [];
for (const [name, version] of web) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) problems.push(`code/web pins ${name} loosely (${version})`);
  if (!mobile.has(name)) problems.push(`${name} is in code/web but not in code/mobile`);
  else if (mobile.get(name) !== version)
    problems.push(`${name}: code/web ${version}, code/mobile ${mobile.get(name)}`);
}

if (problems.length > 0) {
  console.error('Capacitor versions differ between code/web and code/mobile:');
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log(`Capacitor versions match (${web.map(([name, v]) => `${name}@${v}`).join(', ')}).`);
