import type { BabyRoutineDb } from './database';
import type { CachedProduct } from './models';
import type { ProductDto } from '../sync/contract';

/** Products kept on the device for offline search (the most recently used or found). */
export const CATALOG_CACHE_LIMIT = 200;

/**
 * The compact matching key of a name, like the API's: lower case, no diacritics, letters and
 * digits only, repeated letters collapsed (`"Fly-Gass"` -> `flygas`; digits never collapse).
 */
export function productKey(name: string): string {
  const letters = name
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '');
  return letters.replace(/(\p{L})\1+/gu, '$1');
}

/** Remembers products the API returned (or the parent linked), newest use first. */
export async function cacheProducts(
  db: BabyRoutineDb,
  products: readonly ProductDto[],
  usedAt = new Date().toISOString(),
): Promise<void> {
  if (products.length === 0) return;
  await db.transaction('rw', db.catalogProducts, async () => {
    await db.catalogProducts.bulkPut(
      products.map((product) => ({
        id: product.id,
        product,
        key: productKey(product.name),
        usedAt,
      })),
    );
    const extra = (await db.catalogProducts.count()) - CATALOG_CACHE_LIMIT;
    if (extra > 0) {
      const oldest = await db.catalogProducts.orderBy('usedAt').limit(extra).primaryKeys();
      await db.catalogProducts.bulkDelete(oldest);
    }
  });
}

/** Cached non-merged products whose name or substance names contain the query, best first. */
export async function searchCachedProducts(
  db: BabyRoutineDb,
  query: string,
  limit = 10,
): Promise<ProductDto[]> {
  const needle = productKey(query);
  if (needle.length < 2) return [];
  const rows = await db.catalogProducts.toArray();
  const score = (row: CachedProduct): number | null => {
    if (row.product.mergedIntoId) return null;
    if (row.key === needle) return 0;
    if (row.key.startsWith(needle)) return 1;
    if (row.key.includes(needle)) return 2;
    const bySubstance = row.product.substances.some((s) =>
      [s.key, s.nameEn, s.namePtBr].some((name) => productKey(name).includes(needle)),
    );
    return bySubstance ? 3 : null;
  };
  return rows
    .map((row) => ({ row, rank: score(row) }))
    .filter((entry): entry is { row: CachedProduct; rank: number } => entry.rank !== null)
    .sort((a, b) => a.rank - b.rank || b.row.usedAt.localeCompare(a.row.usedAt))
    .slice(0, limit)
    .map((entry) => entry.row.product);
}

export async function cachedProduct(
  db: BabyRoutineDb,
  id: string,
): Promise<ProductDto | undefined> {
  return (await db.catalogProducts.get(id))?.product;
}
