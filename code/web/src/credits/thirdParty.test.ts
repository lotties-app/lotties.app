import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BUILD_ONLY_NUGET, classifyLicense, shippedLockKeys } from '../../scripts/credits-lib.mjs';
import { enCatalog } from '../i18n/catalogEn';
import { ptBRCatalog } from '../i18n/catalogPtBR';
import { CURATED_CREDITS } from './curatedCredits';
import licenses from './third-party-licenses.generated.json';
import summary from './third-party-summary.generated.json';
import list from './third-party.generated.json';

/*
 * Freshness of the generated credits (docs/design/25-credits.md): when a dependency is added,
 * removed or updated and `node code/web/scripts/generate-credits.mjs` was not run, these fail.
 */
const webDir = resolve(import.meta.dirname, '..', '..');
const root = resolve(webDir, '..', '..');
const packages = list.packages;
const read = (path: string) => readFileSync(path, 'utf8');
const readJson = (path: string) => JSON.parse(read(path)) as Record<string, never>;
const has = (ecosystem: string, name: string, version: string) =>
  packages.some((p) => p.ecosystem === ecosystem && p.name === name && p.version === version);

const REGENERATE = 'run: node code/web/scripts/generate-credits.mjs';

function npmShipped(dir: string): { name: string; version: string }[] {
  const lock = readJson(join(dir, 'package-lock.json')) as never as {
    packages: Record<string, { version: string }>;
  };
  const manifest = readJson(join(dir, 'package.json')) as never;
  return shippedLockKeys(lock, manifest, dir === webDir ? undefined : []).map((key: string) => ({
    name: key.slice(key.lastIndexOf('node_modules/') + 'node_modules/'.length),
    version: lock.packages[key].version,
  }));
}

describe('generated third-party credits', () => {
  it.each([
    ['code/web', webDir],
    ['code/mobile', join(root, 'code', 'mobile')],
  ])('lists every production npm package of %s (%s)', (_label, dir) => {
    const missing = npmShipped(dir)
      .filter((p) => !has('npm', p.name, p.version))
      .map((p) => `${p.name}@${p.version}`);
    expect(missing, `missing from the credits; ${REGENERATE}`).toEqual([]);
  });

  it('marks every direct dependency of the web and mobile apps as direct', () => {
    for (const dir of [webDir, join(root, 'code', 'mobile')]) {
      const manifest = readJson(join(dir, 'package.json')) as {
        dependencies?: Record<string, string>;
      };
      for (const name of Object.keys(manifest.dependencies ?? {})) {
        expect(
          packages.some((p) => p.ecosystem === 'npm' && p.name === name && p.direct),
          `${name} is not a direct dependency in the credits; ${REGENERATE}`,
        ).toBe(true);
      }
    }
  });

  it('lists every NuGet package reference of the API projects as direct', () => {
    const src = join(root, 'code', 'api', 'src');
    const ids: string[] = [];
    for (const dir of readdirSync(src)) {
      const csproj = join(src, dir, `${dir}.csproj`);
      if (!existsSync(csproj)) continue;
      for (const match of read(csproj).matchAll(/<PackageReference\s+Include="([^"]+)"/g)) {
        ids.push(match[1]);
      }
    }
    expect(ids.length).toBeGreaterThan(5);
    for (const id of ids.filter((id) => !BUILD_ONLY_NUGET.includes(id))) {
      expect(
        packages.some((p) => p.ecosystem === 'nuget' && p.name === id && p.direct),
        `${id} is missing from the credits; ${REGENERATE}`,
      ).toBe(true);
    }
  });

  it('has no package with an unreviewed or unknown license', () => {
    const flagged = packages
      .filter((p) => classifyLicense(p.license) === 'flag')
      .map((p) => `${p.name}@${p.version}: ${p.license}`);
    expect(flagged, 'review the license (docs/design/25-credits.md) before shipping it').toEqual(
      [],
    );
  });

  it('keeps a license text for every id a package points to', () => {
    for (const pkg of packages) {
      if (pkg.licenseId) expect(licenses).toHaveProperty(pkg.licenseId);
    }
  });

  it('keeps the summary, CREDITS.md and THIRD_PARTY_NOTICES.md in step with the list', () => {
    expect(summary.count).toBe(packages.length);
    expect(summary.directCount).toBe(packages.filter((p) => p.direct).length);
    const credits = read(join(root, 'CREDITS.md'));
    const notices = read(join(root, 'THIRD_PARTY_NOTICES.md'));
    expect(credits, REGENERATE).toContain(`${packages.length} open-source packages`);
    for (const pkg of packages.filter((p) => p.direct)) {
      expect(credits, `${pkg.name} in CREDITS.md; ${REGENERATE}`).toContain(pkg.name);
    }
    for (const pkg of packages) {
      expect(notices, `${pkg.name} in THIRD_PARTY_NOTICES.md; ${REGENERATE}`).toContain(
        `${pkg.name} ${pkg.version}`,
      );
    }
  });

  it('has text in both languages for every curated credit', () => {
    for (const item of CURATED_CREDITS) {
      expect(enCatalog.credits.curated, item.id).toHaveProperty(item.id);
      expect((ptBRCatalog as typeof enCatalog).credits.curated, item.id).toHaveProperty(item.id);
      expect(item.url).toMatch(/^https:\/\//);
    }
  });

  it('flags a non-permissive license in the classifier', () => {
    expect(classifyLicense('MIT')).toBe('ok');
    expect(classifyLicense('(MIT OR Apache-2.0)')).toBe('ok');
    expect(classifyLicense('OFL-1.1')).toBe('reviewed');
    expect(classifyLicense('GPL-2.0-only')).toBe('flag');
    expect(classifyLicense('UNKNOWN (licenseUrl http://x)')).toBe('flag');
    expect(classifyLicense('SSPL-1.0')).toBe('flag');
  });
});
