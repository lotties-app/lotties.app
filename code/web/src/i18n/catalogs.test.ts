import { describe, expect, it } from 'vitest';
import en from './locales/en.json';
import ptBR from './locales/pt-BR.json';
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
