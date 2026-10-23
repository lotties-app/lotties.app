import type { Catalog } from './catalogEn';
import { mergeCatalogFiles } from './mergeCatalog';

/**
 * The Brazilian Portuguese catalog: every `locales/pt-BR/*.json`, merged. i18n.ts imports this
 * module dynamically, so it stays one lazy chunk. Same shape as English (catalogs.test.ts checks
 * that both languages have the same keys).
 */
export const ptBRCatalog = mergeCatalogFiles(
  import.meta.glob('./locales/pt-BR/*.json', { eager: true, import: 'default' }),
) as Catalog;
