import { useEffect, useState } from 'react';
import { useApiClient } from '../api/ApiClientContext';
import { useAuth } from '../auth/useAuth';
import {
  cacheProducts,
  matchesOnlyBySubstance,
  productKey,
  searchCachedProducts,
} from '../db/catalogCache';
import { useDatabase } from '../db/DatabaseContext';
import { useOnline } from '../sync/useOnline';
import {
  CATALOG_MIN_QUERY,
  isOfficial,
  searchProducts,
  siblingsIn,
  type CatalogMatch,
} from './catalogApi';

export const CATALOG_DEBOUNCE_MS = 300;

export interface CatalogSearch {
  /** `null` until a query long enough to search was typed. */
  matches: CatalogMatch[] | null;
  loading: boolean;
  /** The results come from the products cached on this device (offline or the request failed). */
  fromCache: boolean;
}

const IDLE: CatalogSearch = { matches: null, loading: false, fromCache: false };

/**
 * Shared-catalog search as you type: debounced `GET /catalog/products?q=` while online and signed
 * in; otherwise (or when the request fails) the products cached on this device. Found community
 * products are cached, so they stay searchable offline; official (ANVISA) products are thousands,
 * so only the ones the parent picks are cached (docs/design/13-anvisa-catalog.md).
 */
export function useCatalogSearch(query: string, enabled = true): CatalogSearch {
  const api = useApiClient();
  const db = useDatabase();
  const { isAuthenticated } = useAuth();
  const online = useOnline();
  const trimmed = query.trim();
  const searchable = enabled && productKey(trimmed).length >= CATALOG_MIN_QUERY;
  const [state, setState] = useState<{ key: string; result: CatalogSearch }>({
    key: '',
    result: IDLE,
  });
  const requestKey = searchable ? `${trimmed}|${online && isAuthenticated}` : '';

  useEffect(() => {
    if (!searchable) return;
    const controller = new AbortController();
    const run = async () => {
      let result: CatalogSearch;
      try {
        if (!online || !isAuthenticated) throw new Error('offline');
        const matches = await searchProducts(api, trimmed, controller.signal);
        await cacheProducts(
          db,
          matches.map((m) => m.product).filter((product) => !isOfficial(product)),
        );
        result = { matches, loading: false, fromCache: false };
      } catch {
        if (controller.signal.aborted) return;
        const products = await searchCachedProducts(db, trimmed);
        const all = await db.catalogProducts.toArray();
        const matches = products.map((product): CatalogMatch => ({
          product,
          siblings: siblingsIn(
            product,
            all.map((row) => row.product),
          ),
          matchedBy: matchesOnlyBySubstance(product, trimmed) ? 'substance' : 'name',
        }));
        result = { matches, loading: false, fromCache: true };
      }
      if (!controller.signal.aborted) setState({ key: requestKey, result });
    };
    const timer = setTimeout(() => void run(), CATALOG_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [searchable, trimmed, online, isAuthenticated, api, db, requestKey]);

  if (!searchable) return IDLE;
  return state.key === requestKey ? state.result : { ...state.result, loading: true };
}
