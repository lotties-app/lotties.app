import { ApiError } from '../api/ApiError';
import type { ApiClient } from '../api/apiClient';
import {
  apiPaths,
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

/** A product with the other products that contain the same active ingredient (information only). */
export interface CatalogMatch {
  product: ProductDto;
  siblings: SiblingProductDto[];
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
  }));
}

export interface CreatedProduct {
  product: ProductDto;
  /** The API already had this product (409 `product_exists`): the existing one is used. */
  existed: boolean;
}

function isProduct(value: unknown): value is ProductDto {
  const product = value as Partial<ProductDto> | null;
  return typeof product === 'object' && product !== null && typeof product.id === 'string';
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

/** Cached products that share exactly the same non-empty substance set (offline siblings). */
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
  return others
    .filter((o) => o.id !== product.id && !o.mergedIntoId && ids(o) === mine)
    .slice(0, 10)
    .map(({ id, name, form, country, status }) => ({ id, name, form, country, status }));
}
