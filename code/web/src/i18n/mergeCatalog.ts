/** The JSON files of one language, as `import.meta.glob(..., { eager: true, import: 'default' })` returns them. */
export type CatalogFiles = Record<string, unknown>;

/**
 * Merges the per-feature catalog files of one language (`locales/<lang>/*.json`) into the one
 * `translation` namespace. Every top-level key belongs to exactly one file: a key found in two
 * files throws, naming both, so two features never silently overwrite each other's text.
 */
export function mergeCatalogFiles(files: CatalogFiles): Record<string, unknown> {
  const owners = new Map<string, string>();
  const entries: [string, unknown][] = [];
  for (const file of Object.keys(files).sort()) {
    const content = files[file];
    if (typeof content !== 'object' || content === null || Array.isArray(content)) {
      throw new Error(`Catalog file ${file} must hold a JSON object`);
    }
    for (const [key, value] of Object.entries(content)) {
      const owner = owners.get(key);
      if (owner !== undefined) {
        throw new Error(
          `Duplicate top-level catalog key "${key}" in ${owner} and ${file}: each key belongs to one feature file`,
        );
      }
      owners.set(key, file);
      entries.push([key, value]);
    }
  }
  // fromEntries defines own properties: a key such as `__proto__` stays plain data.
  return Object.fromEntries(entries);
}
