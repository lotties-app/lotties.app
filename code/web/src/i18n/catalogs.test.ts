import { describe, expect, it } from 'vitest';
import { enCatalog as en } from './catalogEn';
import catalogEnSource from './catalogEn.ts?raw';
import { ptBRCatalog as ptBR } from './catalogPtBR';
import { activateLocale, i18n, t } from './i18n';
import landingEn from './locales/landing.en.json';
import landingPtBR from './locales/landing.pt-BR.json';
import pushEn from './locales/push.en.json';
import pushPtBR from './locales/push.pt-BR.json';

/** `a.b.c` paths of every string in a catalog. */
function leaves(node: unknown, prefix = ''): Map<string, string> {
  const result = new Map<string, string>();
  if (typeof node === 'string') {
    result.set(prefix, node);
  } else if (typeof node === 'object' && node !== null) {
    for (const [key, value] of Object.entries(node)) {
      const path = prefix ? `${prefix}.${key}` : key;
      for (const [leafPath, leaf] of leaves(value, path)) result.set(leafPath, leaf);
    }
  }
  return result;
}

/**
 * The landing and push (service worker) namespaces have their own files; their keys are prefixed so
 * one set of rules covers all of them.
 */
const withPrefix = (prefix: string, catalog: Map<string, string>) =>
  new Map([...catalog].map(([key, text]) => [`${prefix}${key}`, text]));

const CATALOGS = {
  en: new Map([
    ...leaves(en),
    ...withPrefix('landing:', leaves(landingEn)),
    ...withPrefix('push:', leaves(pushEn)),
  ]),
  'pt-BR': new Map([
    ...leaves(ptBR),
    ...withPrefix('landing:', leaves(landingPtBR)),
    ...withPrefix('push:', leaves(pushPtBR)),
  ]),
} as const;
const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;
const REQUIRED_PLURALS = ['one', 'other'];

const placeholders = (text: string) =>
  [...text.matchAll(/\{\{\s*(\w+)[^}]*\}\}/g)].map((m) => m[1]).sort();

const missingFrom = (keys: Iterable<string>, catalog: Map<string, string>) =>
  [...keys].filter((key) => !catalog.has(key));

describe('translation catalogs', () => {
  it('have exactly the same keys in en and pt-BR', () => {
    expect(missingFrom(CATALOGS.en.keys(), CATALOGS['pt-BR'])).toEqual([]);
    expect(missingFrom(CATALOGS['pt-BR'].keys(), CATALOGS.en)).toEqual([]);
  });

  it('have no empty strings', () => {
    for (const [name, catalog] of Object.entries(CATALOGS)) {
      const empty = [...catalog].filter(([, text]) => text.trim() === '').map(([key]) => key);
      expect(empty, name).toEqual([]);
    }
  });

  it('use the same interpolation placeholders for every key', () => {
    const mismatched = [...CATALOGS.en]
      .filter(([key, text]) => {
        const other = CATALOGS['pt-BR'].get(key);
        return other !== undefined && placeholders(text).join() !== placeholders(other).join();
      })
      .map(([key]) => key);
    expect(mismatched).toEqual([]);
  });

  it('define every required plural form for each plural key', () => {
    for (const [name, catalog] of Object.entries(CATALOGS)) {
      const forms = new Map<string, Set<string>>();
      for (const key of catalog.keys()) {
        const match = PLURAL_SUFFIX.exec(key);
        if (!match) continue;
        const base = key.slice(0, match.index);
        forms.set(base, (forms.get(base) ?? new Set()).add(match[1]));
      }
      const incomplete = [...forms]
        .filter(([, present]) => !REQUIRED_PLURALS.every((form) => present.has(form)))
        .map(([base]) => base);
      expect(incomplete, name).toEqual([]);
    }
  });

  it('give plural keys the same forms in both languages', () => {
    const forms = (catalog: Map<string, string>) =>
      [...catalog.keys()].filter((key) => PLURAL_SUFFIX.test(key)).sort();
    expect(forms(CATALOGS['pt-BR'])).toEqual(forms(CATALOGS.en));
  });

  it('use the count placeholder in every plural form', () => {
    for (const [name, catalog] of Object.entries(CATALOGS)) {
      const missing = [...catalog]
        .filter(([key, text]) => PLURAL_SUFFIX.test(key) && !placeholders(text).includes('count'))
        .map(([key]) => key);
      expect(missing, name).toEqual([]);
    }
  });
});

/** The per-feature files of each language (`locales/<lang>/*.json`), keyed by their glob path. */
const FILES = {
  en: import.meta.glob<Record<string, unknown>>('./locales/en/*.json', {
    eager: true,
    import: 'default',
  }),
  'pt-BR': import.meta.glob<Record<string, unknown>>('./locales/pt-BR/*.json', {
    eager: true,
    import: 'default',
  }),
};

/** `vaccines.json` -> its sorted top-level keys. */
const topLevelKeysByFile = (files: Record<string, Record<string, unknown>>) =>
  Object.fromEntries(
    Object.entries(files).map(([path, content]) => [
      path.slice(path.lastIndexOf('/') + 1),
      Object.keys(content).sort(),
    ]),
  );

describe('per-feature catalog files', () => {
  it('exist for every feature in both languages, with the same top-level keys in the same file', () => {
    expect(Object.keys(FILES.en).length).toBeGreaterThan(0);
    expect(topLevelKeysByFile(FILES['pt-BR'])).toEqual(topLevelKeysByFile(FILES.en));
  });

  it('give each top-level key to one file only', () => {
    for (const [name, files] of Object.entries(FILES)) {
      const keys = Object.values(files).flatMap((content) => Object.keys(content));
      expect(
        keys.filter((key, index) => keys.indexOf(key) !== index),
        name,
      ).toEqual([]);
    }
  });

  it('merge into one catalog holding every file', () => {
    for (const [name, catalog] of Object.entries({ en, 'pt-BR': ptBR })) {
      const fromFiles = Object.assign({}, ...Object.values(FILES[name as keyof typeof FILES]));
      expect(catalog, name).toEqual(fromFiles);
    }
  });

  it('are all part of the typed catalog (catalogEn.ts)', () => {
    const untyped = Object.keys(FILES.en).filter(
      (path) => !catalogEnSource.includes(`import('${path}')`),
    );
    expect(untyped).toEqual([]);
  });
});

describe('the merged catalog at runtime', () => {
  it('resolves keys of several feature files in English and in Brazilian Portuguese', async () => {
    const sample = () => [
      t('common.save'),
      t('vaccines.title'),
      t('nav.settings'),
      t('appointments.title'),
      t('age.day', { count: 2 }),
    ];
    expect(sample()).toEqual(['Save', 'Vaccines', 'Settings', 'Appointments', '2 days']);

    await activateLocale('pt-BR');
    expect(i18n.language).toBe('pt-BR');
    expect(sample()).toEqual(['Salvar', 'Vacinas', 'Ajustes', 'Consultas', '2 dias']);
  });
});
