import { describe, expect, it } from 'vitest';
import { mergeCatalogFiles } from './mergeCatalog';

describe('mergeCatalogFiles', () => {
  it('merges the top-level keys of every file', () => {
    const merged = mergeCatalogFiles({
      './locales/en/vaccines.json': { vaccines: { title: 'Vaccines' } },
      './locales/en/common.json': { common: { save: 'Save' }, age: { day_one: '{{count}} day' } },
    });

    expect(merged).toEqual({
      common: { save: 'Save' },
      age: { day_one: '{{count}} day' },
      vaccines: { title: 'Vaccines' },
    });
  });

  it('fails on a top-level key found in two files, naming both', () => {
    expect(() =>
      mergeCatalogFiles({
        './locales/en/vaccines.json': { vaccines: { title: 'Vaccines' } },
        './locales/en/appointments.json': { vaccines: { due: 'Due' } },
      }),
    ).toThrow(
      'Duplicate top-level catalog key "vaccines" in ./locales/en/appointments.json and ./locales/en/vaccines.json',
    );
  });

  it('fails on a file that does not hold an object', () => {
    expect(() => mergeCatalogFiles({ './locales/en/broken.json': ['a'] })).toThrow(
      'Catalog file ./locales/en/broken.json must hold a JSON object',
    );
  });

  it('keeps a __proto__ key as plain data', () => {
    const merged = mergeCatalogFiles({
      './locales/en/odd.json': JSON.parse('{"__proto__": {"polluted": "yes"}}') as object,
    });

    expect(Object.hasOwn(merged, '__proto__')).toBe(true);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.getPrototypeOf(merged)).toBe(Object.prototype);
  });
});
