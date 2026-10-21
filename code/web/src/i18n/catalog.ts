import { DEFAULT_LOCALE } from './config';
import { i18n } from './i18n';

/**
 * Looks up a catalog entry whose path is built from server-provided keys (event type, field and
 * option keys, problem codes). Only own properties count, so a key such as `constructor` never
 * resolves to an inherited member. Falls back to the English catalog, then to `undefined`.
 */
export function catalogText(...path: string[]): string | undefined {
  for (const language of new Set([i18n.language, DEFAULT_LOCALE])) {
    let node: unknown = i18n.getResourceBundle(language, 'translation');
    for (const segment of path) {
      if (typeof node !== 'object' || node === null || !Object.hasOwn(node, segment)) {
        node = undefined;
        break;
      }
      node = (node as Record<string, unknown>)[segment];
    }
    if (typeof node === 'string') return node;
  }
  return undefined;
}

/** Same lookup, but renders the entry with interpolation values. */
export function renderCatalogText(
  path: string[],
  values: Record<string, unknown> = {},
): string | undefined {
  const raw = catalogText(...path);
  if (raw === undefined) return undefined;
  return raw.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, name: string) =>
    Object.hasOwn(values, name) ? String(values[name]) : '',
  );
}
