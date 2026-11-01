import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApiClient } from '../api/ApiClientContext';
import {
  fetchItem,
  fetchItems,
  fetchKeys,
  fetchSummary,
  fetchTopics,
  listQueryString,
  type BoardListQuery,
} from './boardApi';
import { boardKey } from './useBoardAccess';

/*
 * The board's server data through TanStack Query, in memory only (never the device's database):
 * the page needs a connection, and a stale list is refetched when it is opened again. A request
 * whose list is no longer shown (a new search, another view) is aborted through its signal.
 */

/** Items per page of the list ("Load more" asks for the next one). */
export const PAGE_SIZE = 50;

const keys = {
  topics: (archived: boolean) => [...boardKey, 'topics', archived] as const,
  summary: () => [...boardKey, 'summary'] as const,
  items: (query: string) => [...boardKey, 'items', query] as const,
  item: (id: string) => [...boardKey, 'item', id] as const,
  keys: () => [...boardKey, 'keys'] as const,
};

export function useBoardTopics(includeArchived = false) {
  const api = useApiClient();
  return useQuery({
    queryKey: keys.topics(includeArchived),
    queryFn: ({ signal }) => fetchTopics(api, includeArchived, signal),
    staleTime: 60_000,
  });
}

export function useBoardSummary() {
  const api = useApiClient();
  return useQuery({
    queryKey: keys.summary(),
    queryFn: ({ signal }) => fetchSummary(api, signal),
  });
}

export function useBoardItems(query: BoardListQuery) {
  const api = useApiClient();
  return useInfiniteQuery({
    queryKey: keys.items(listQueryString(query)),
    queryFn: ({ signal, pageParam }) =>
      fetchItems(api, { ...query, limit: PAGE_SIZE, cursor: pageParam }, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.nextCursor,
  });
}

export function useBoardItem(id: string | undefined) {
  const api = useApiClient();
  return useQuery({
    queryKey: keys.item(id ?? ''),
    queryFn: ({ signal }) => fetchItem(api, id!, signal),
    enabled: !!id,
    retry: false,
  });
}

export function useBoardKeys(enabled: boolean) {
  const api = useApiClient();
  return useQuery({
    queryKey: keys.keys(),
    queryFn: ({ signal }) => fetchKeys(api, signal),
    enabled,
  });
}

/** Refreshes what a write changed: the lists, the summary and (when given) one item. */
export function useBoardRefresh() {
  const client = useQueryClient();
  return {
    lists: (itemId?: string) => {
      void client.invalidateQueries({ queryKey: [...boardKey, 'items'] });
      void client.invalidateQueries({ queryKey: keys.summary() });
      if (itemId) void client.invalidateQueries({ queryKey: keys.item(itemId) });
    },
    item: (itemId: string) => client.invalidateQueries({ queryKey: keys.item(itemId) }),
    topics: () => client.invalidateQueries({ queryKey: [...boardKey, 'topics'] }),
    keys: () => client.invalidateQueries({ queryKey: keys.keys() }),
  };
}
