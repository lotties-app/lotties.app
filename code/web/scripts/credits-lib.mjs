// Shared logic of the third-party credits generator (scripts/generate-credits.mjs) and of the
// freshness test (src/credits/thirdParty.test.ts). Pure functions over package-lock.json files and
// the NuGet restore output; no dependencies. See docs/design/25-credits.md.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Development dependencies whose code still ships to users: the service worker bundles
 * workbox-precaching and workbox-routing (src/pwa/sw/sw.ts), although package.json lists them
 * under devDependencies. Their dependencies are followed too.
 */
export const SHIPPED_DEV_DEPENDENCIES = ['workbox-precaching', 'workbox-routing'];

/** NuGet packages that are build or design time only (PrivateAssets=all): nothing of them ships. */
export const BUILD_ONLY_NUGET = ['Microsoft.EntityFrameworkCore.Design'];

/** Licenses reviewed as compatible with distributing inside an AGPL-3.0 app (permissive). */
export const PERMISSIVE_LICENSES = [
  '0BSD',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'BlueOak-1.0.0',
  'CC0-1.0',
  'ISC',
  'MIT',
  'Unlicense',
  'Zlib',
];

/**
 * Licenses reviewed one by one: allowed, but worth knowing. OFL-1.1 covers the bundled font only
 * (embedding in an app is allowed; the font is not sold alone). The others have a specific note.
 */
export const REVIEWED_LICENSES = {
  PostgreSQL:
    'PostgreSQL License: permissive (BSD or MIT like), OSI approved, compatible with AGPL-3.0.',
  'OFL-1.1':
    'SIL Open Font License 1.1: fonts may be bundled and used freely; the font files are not sold on their own and keep their name and notice.',
  'MPL-2.0':
    'Mozilla Public License 2.0: file-level copyleft, allowed with AGPL-3.0 (section 3.3 of the MPL); modified MPL files stay under the MPL.',
};

export const sha1 = (text) => createHash('sha1').update(text).digest('hex').slice(0, 12);

/** Splits an SPDX expression such as "(MIT OR Apache-2.0)" into its license ids. */
export function spdxIds(expression) {
  return expression
    .replace(/[()]/g, ' ')
    .split(/\s+(?:OR|AND|WITH)\s+|\s+/)
    .map((part) => part.trim())
    .filter((part) => part && !/^(OR|AND|WITH)$/i.test(part));
}

/** 'ok' when every id is permissive; 'reviewed' when each is permissive or reviewed; else 'flag'. */
export function classifyLicense(expression) {
  if (!expression || /^unknown/i.test(expression)) return 'flag';
  const ids = spdxIds(expression);
  // "A OR B": the user can choose, so one acceptable alternative is enough.
  const alternatives = /\sOR\s/.test(expression);
  const status = ids.map((id) =>
    PERMISSIVE_LICENSES.includes(id) ? 'ok' : id in REVIEWED_LICENSES ? 'reviewed' : 'flag',
  );
  if (alternatives && status.includes('ok')) return 'ok';
  if (status.every((s) => s === 'ok')) return 'ok';
  if (status.every((s) => s !== 'flag')) return 'reviewed';
  return 'flag';
}

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

/** The package name of a lock key such as "node_modules/a/node_modules/@b/c". */
function nameOfKey(key) {
  const index = key.lastIndexOf('node_modules/');
  return key.slice(index + 'node_modules/'.length);
}

/** Resolves `dep` as `parentKey` would (node_modules lookup walking up), to a lock key. */
function resolveKey(packages, parentKey, dep) {
  let base = parentKey;
  for (;;) {
    const candidate = base ? `${base}/node_modules/${dep}` : `node_modules/${dep}`;
    if (packages[candidate]) return candidate;
    if (!base) return null;
    const cut = base.lastIndexOf('/node_modules/');
    base = cut === -1 ? '' : base.slice(0, cut);
  }
}

/**
 * The npm packages of one project that ship: the lock's production tree (everything npm installs
 * with --omit=dev) minus packages only reachable as direct devDependencies, plus
 * SHIPPED_DEV_DEPENDENCIES and their own dependencies. Returns lock keys, sorted.
 */
export function shippedLockKeys(lock, manifest, shippedDev = SHIPPED_DEV_DEPENDENCIES) {
  const packages = lock.packages;
  const devNames = new Set(Object.keys(manifest.devDependencies ?? {}));
  const keys = new Set();
  for (const [key, entry] of Object.entries(packages)) {
    if (!key || entry.dev || entry.devOptional || entry.link) continue;
    // Pulled in by an optional peer of a production package only (typescript via cosmiconfig).
    if (key === `node_modules/${nameOfKey(key)}` && devNames.has(nameOfKey(key))) continue;
    keys.add(key);
  }
  const visited = new Set();
  const queue = shippedDev
    .filter((name) => manifest.devDependencies?.[name] || manifest.dependencies?.[name])
    .map((name) => resolveKey(packages, '', name))
    .filter(Boolean);
  while (queue.length) {
    const key = queue.pop();
    if (visited.has(key)) continue;
    visited.add(key);
    keys.add(key);
    for (const dep of Object.keys(packages[key].dependencies ?? {})) {
      const next = resolveKey(packages, key, dep);
      if (next) queue.push(next);
    }
  }
  return [...keys].sort();
}

/** A package.json `repository` field as a browsable https URL, or null. */
export function repositoryUrl(repository) {
  const raw = typeof repository === 'string' ? repository : repository?.url;
  if (!raw) return null;
  let url = raw
    .trim()
    .replace(/^git\+/, '')
    .replace(/\.git$/, '');
  url = url.replace(/^git:\/\//, 'https://').replace(/^ssh:\/\/git@/, 'https://');
  url = url.replace(/^git@github\.com:/, 'https://github.com/');
  if (/^[\w.-]+\/[\w.-]+$/.test(url)) url = `https://github.com/${url}`;
  if (/^github:/.test(url)) url = `https://github.com/${url.slice(7)}`;
  return /^https?:\/\//.test(url) ? url : null;
}

const LICENSE_FILE = /^(licen[sc]e|licence|copying|unlicense)([.-][\w.-]*)?$/i;

/** The text of the license file shipped inside a package folder, or null. */
export function readLicenseFile(dir) {
  if (!existsSync(dir)) return null;
  const file = readdirSync(dir)
    .filter((name) => LICENSE_FILE.test(name))
    .sort((a, b) => a.length - b.length)[0];
  if (!file) return null;
  const text = readFileSync(join(dir, file), 'utf8').replace(/\r\n/g, '\n').trim();
  return text || null;
}

/** npm packages of one project as credit records (without the license text). */
export function npmPackages({ projectDir, source, shippedDev = SHIPPED_DEV_DEPENDENCIES }) {
  const lock = readJson(join(projectDir, 'package-lock.json'));
  const manifest = readJson(join(projectDir, 'package.json'));
  const direct = new Set(Object.keys(manifest.dependencies ?? {}));
  const shipped = new Set(shippedDev.filter((name) => manifest.devDependencies?.[name]));
  const out = [];
  for (const key of shippedLockKeys(lock, manifest, shippedDev)) {
    const entry = lock.packages[key];
    const name = nameOfKey(key);
    const folder = join(projectDir, key);
    let meta = {};
    if (existsSync(join(folder, 'package.json'))) meta = readJson(join(folder, 'package.json'));
    const license =
      (typeof meta.license === 'string' ? meta.license : meta.license?.type) ||
      entry.license ||
      meta.licenses?.map((l) => l.type).join(' OR ') ||
      'UNKNOWN';
    out.push({
      ecosystem: 'npm',
      name,
      version: entry.version,
      license,
      homepage: meta.homepage ?? null,
      repository: repositoryUrl(meta.repository),
      direct: key === `node_modules/${name}` && (direct.has(name) || shipped.has(name)),
      sources: [source],
      licenseText: readLicenseFile(folder),
    });
  }
  return out;
}

/** Merges the same name@version found by several projects (web and mobile). */
export function mergePackages(list) {
  const map = new Map();
  for (const item of list) {
    const key = `${item.ecosystem}:${item.name}@${item.version}`;
    const known = map.get(key);
    if (!known) {
      map.set(key, { ...item, sources: [...item.sources] });
      continue;
    }
    known.direct ||= item.direct;
    known.sources = [...new Set([...known.sources, ...item.sources])].sort();
    known.licenseText ??= item.licenseText;
    known.homepage ??= item.homepage;
    known.repository ??= item.repository;
  }
  return [...map.values()].sort(
    (a, b) =>
      a.ecosystem.localeCompare(b.ecosystem) ||
      a.name.localeCompare(b.name) ||
      a.version.localeCompare(b.version),
  );
}

const tag = (xml, name) => {
  const match = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i').exec(xml);
  return match ? match[1].trim() : null;
};

/** Guesses the SPDX id of a license file's text; null when it is not one of the common ones. */
export function guessLicenseFromText(text) {
  if (!text) return null;
  if (/MIT License|Permission is hereby granted, free of charge/i.test(text)) return 'MIT';
  if (/Apache License\s+Version 2\.0/i.test(text)) return 'Apache-2.0';
  return null;
}

const authorsLine = (nuspec) => {
  const authors = tag(nuspec, 'authors');
  return authors ? `Copyright (c) ${authors}` : null;
};

const MIT_TEXT = `Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`;

const POSTGRESQL_TEXT = `Permission to use, copy, modify, and distribute this software and its documentation for any purpose, without fee, and without a written agreement is hereby granted, provided that the above copyright notice and this paragraph and the following two paragraphs appear in all copies.

IN NO EVENT SHALL THE AUTHORS BE LIABLE TO ANY PARTY FOR DIRECT, INDIRECT, SPECIAL, INCIDENTAL, OR CONSEQUENTIAL DAMAGES, INCLUDING LOST PROFITS, ARISING OUT OF THE USE OF THIS SOFTWARE AND ITS DOCUMENTATION, EVEN IF THE AUTHORS HAVE BEEN ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

THE AUTHORS SPECIFICALLY DISCLAIM ANY WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE. THE SOFTWARE PROVIDED HEREUNDER IS ON AN "AS IS" BASIS, AND THE AUTHORS HAVE NO OBLIGATIONS TO PROVIDE MAINTENANCE, SUPPORT, UPDATES, ENHANCEMENTS, OR MODIFICATIONS.`;

const APACHE_NOTICE = `Licensed under the Apache License, Version 2.0 (the "License"); you may not use this software except in compliance with the License. You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.`;

/**
 * NuGet packages ship no license file, only an SPDX id in the .nuspec. For MIT and the PostgreSQL
 * license the notice is the package's own copyright line plus the standard text of that license
 * (the text is identical for every holder); other licenses get no synthesized text.
 */
function standardNotice(license, copyright) {
  if (!copyright) return null;
  const body = { MIT: MIT_TEXT, PostgreSQL: POSTGRESQL_TEXT, 'Apache-2.0': APACHE_NOTICE }[license];
  return body
    ? `${copyright}

${body}`
    : null;
}

/** NuGet packages that ship with the API, read from the restore output and the package cache. */
export function nugetPackages({ srcDir, framework = 'net8.0' }) {
  const projects = readdirSync(srcDir, { withFileTypes: true })
    .filter(
      (d) => d.isDirectory() && existsSync(join(srcDir, d.name, 'obj', 'project.assets.json')),
    )
    .map((d) => readJson(join(srcDir, d.name, 'obj', 'project.assets.json')));
  if (projects.length === 0) {
    throw new Error(
      'No project.assets.json found: run "dotnet restore code/api/Lotties.sln" first.',
    );
  }
  const found = new Map();
  const directIds = new Set();
  for (const assets of projects) {
    const folder = Object.keys(assets.packageFolders)[0];
    const target = assets.targets[Object.keys(assets.targets)[0]];
    const groups = Object.values(assets.projectFileDependencyGroups).flat();
    const roots = groups
      .map((line) => line.split(/\s/)[0])
      .filter((id) => !BUILD_ONLY_NUGET.includes(id));
    const byId = new Map();
    for (const key of Object.keys(target)) {
      const [id, version] = key.split('/');
      byId.set(id.toLowerCase(), { id, version, entry: target[key] });
    }
    const queue = [...roots];
    for (const id of roots)
      if (byId.get(id.toLowerCase())?.entry.type === 'package') directIds.add(id);
    const seen = new Set();
    while (queue.length) {
      const id = queue.pop();
      const hit = byId.get(id.toLowerCase());
      if (!hit || seen.has(hit.id.toLowerCase())) continue;
      seen.add(hit.id.toLowerCase());
      if (hit.entry.type !== 'package') {
        // A project reference: follow it for its own package references.
        for (const dep of Object.keys(hit.entry.dependencies ?? {})) queue.push(dep);
        continue;
      }
      found.set(`${hit.id}@${hit.version}`, { id: hit.id, version: hit.version, folder });
      for (const dep of Object.keys(hit.entry.dependencies ?? {})) queue.push(dep);
    }
  }
  const out = [];
  for (const { id, version, folder } of found.values()) {
    const dir = join(folder, id.toLowerCase(), version);
    const nuspecPath = join(dir, `${id.toLowerCase()}.nuspec`);
    if (!existsSync(nuspecPath))
      throw new Error(`Package not in the NuGet cache: ${id} ${version}`);
    const nuspec = readFileSync(nuspecPath, 'utf8');
    const licenseMatch = /<license\s+type="(\w+)"[^>]*>([^<]*)<\/license>/i.exec(nuspec);
    let license = 'UNKNOWN';
    let licenseText = null;
    if (licenseMatch && licenseMatch[1] === 'expression') {
      license = licenseMatch[2].trim();
    } else if (licenseMatch && licenseMatch[1] === 'file') {
      const file = join(dir, licenseMatch[2].trim());
      licenseText = existsSync(file)
        ? readFileSync(file, 'utf8').replace(/\r\n/g, '\n').trim()
        : null;
      license = guessLicenseFromText(licenseText) ?? 'UNKNOWN (license file)';
    } else if (tag(nuspec, 'licenseUrl')) {
      license = `UNKNOWN (licenseUrl ${tag(nuspec, 'licenseUrl')})`;
    }
    licenseText ??= readLicenseFile(dir);
    licenseText ??= standardNotice(license, tag(nuspec, 'copyright') ?? authorsLine(nuspec));
    const repo = /<repository[^>]*\burl="([^"]+)"/i.exec(nuspec);
    out.push({
      ecosystem: 'nuget',
      name: id,
      version,
      license,
      homepage: tag(nuspec, 'projectUrl'),
      repository: repo ? repositoryUrl(repo[1]) : null,
      direct: directIds.has(id),
      sources: ['api'],
      licenseText,
    });
  }
  return mergePackages(out);
}
