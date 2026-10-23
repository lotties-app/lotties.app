import { ApiError } from '../api/ApiError';
import type { ApiClient } from '../api/apiClient';
import { productKey } from '../db/catalogCache';
import {
  apiPaths,
  type AlternativeLevel,
  type CreateProductRequest,
  type ProductDto,
  type ProductMatchDto,
  type SiblingProductDto,
} from '../sync/contract';

/* Shared medication catalog calls (instance-wide, online only; docs/SPEC.md "Medications: catalog"). */

/** Shortest query the API accepts (at least 2 letters or digits). */
export const CATALOG_MIN_QUERY = 2;
export const CATALOG_MAX_QUERY = 100;
export const CATALOG_SEARCH_LIMIT = 10;

/** How a search result matched: by its name (or a merged alias), or by one of its active ingredients. */
export type CatalogMatchKind = ProductMatchDto['matchedBy'];

/** A product with the other products that contain the same active ingredient (information only). */
export interface CatalogMatch {
  product: ProductDto;
  siblings: SiblingProductDto[];
  matchedBy: CatalogMatchKind;
}

/** Official products come from the official registry the importer read (ANVISA): labelled and attributed. */
export function isOfficial(product: Pick<ProductDto, 'status'>): boolean {
  return product.status === 'official';
}

/** Curated products come from the importer's small curated list (not reviewed by a pharmacist). */
export function isCurated(product: Pick<ProductDto, 'status'>): boolean {
  return product.status === 'curated';
}

/** Order of lists, like the API: official first, then curated, then the rest. */
export function sourceRank(product: Pick<ProductDto, 'status'>): number {
  if (isOfficial(product)) return 0;
  return isCurated(product) ? 1 : 2;
}

/** Groups of alternatives, best first. */
export const ALTERNATIVE_LEVELS: readonly AlternativeLevel[] = [
  'equivalent',
  'differentForm',
  'strengthNotKnown',
  'differentStrength',
];

/**
 * The level of an alternative. A missing or unknown value (an older server, the offline list) is
 * `strengthNotKnown`: it never reads as equivalent.
 */
export function alternativeLevel(sibling: Pick<SiblingProductDto, 'matchLevel'>): AlternativeLevel {
  return ALTERNATIVE_LEVELS.find((level) => level === sibling.matchLevel) ?? 'strengthNotKnown';
}

export async function searchProducts(
  api: ApiClient,
  query: string,
  signal?: AbortSignal,
): Promise<CatalogMatch[]> {
  const list = await api.request<ProductMatchDto[]>(
    apiPaths.catalogProducts(query.slice(0, CATALOG_MAX_QUERY), CATALOG_SEARCH_LIMIT),
    signal ? { signal } : {},
  );
  return (Array.isArray(list) ? list : []).map((match) => ({
    product: match.product,
    siblings: match.sameActiveIngredient ?? [],
    matchedBy:
      match.matchedBy === 'substance'
        ? 'substance'
        : match.matchedBy === 'alias'
          ? 'alias'
          : 'name',
  }));
}

export interface CreatedProduct {
  product: ProductDto;
  /** The API already had this product (409 `product_exists`): the existing one is used. */
  existed: boolean;
}

export function isProduct(value: unknown): value is ProductDto {
  const product = value as Partial<ProductDto> | null;
  return (
    typeof product === 'object' &&
    product !== null &&
    typeof product.id === 'string' &&
    Array.isArray(product.substances)
  );
}

/**
 * Adds a community product after the server's duplicate check. A duplicate (409 `product_exists`)
 * is not an error: the existing product comes back with `existed: true` so it can be used instead.
 */
export async function createProduct(
  api: ApiClient,
  request: CreateProductRequest,
): Promise<CreatedProduct> {
  try {
    const product = await api.request<ProductDto>(apiPaths.catalogProducts(), {
      method: 'POST',
      body: request,
    });
    return { product, existed: false };
  } catch (error) {
    if (error instanceof ApiError && error.status === 409 && error.code === 'product_exists') {
      const existing = error.problem?.product;
      if (isProduct(existing)) return { product: existing, existed: true };
    }
    throw error;
  }
}

/** Names of the products' substances, e.g. `simethicone`, in the given language. */
export function substanceNames(product: ProductDto, language: 'en' | 'pt-BR'): string[] {
  return product.substances.map((s) => (language === 'pt-BR' ? s.namePtBr : s.nameEn) || s.key);
}

/**
 * Cached products that share exactly the same non-empty substance set (offline siblings), like the
 * API: active ones only, not the same name in another form, official first.
 */
export function siblingsIn(
  product: ProductDto,
  others: readonly ProductDto[],
): SiblingProductDto[] {
  const ids = (p: ProductDto) =>
    p.substances
      .map((s) => s.substanceId)
      .sort()
      .join('|');
  const mine = ids(product);
  if (mine === '') return [];
  const name = productKey(product.name);
  return others
    .filter(
      (o) =>
        o.id !== product.id &&
        !o.mergedIntoId &&
        !o.inactive &&
        productKey(o.name) !== name &&
        ids(o) === mine,
    )
    .sort((a, b) => sourceRank(a) - sourceRank(b))
    .slice(0, 10)
    .map(({ id, name, form, country, status, strengthText }) => ({
      id,
      name,
      form,
      country,
      status,
      strengthText: strengthText ?? null,
    }));
}
