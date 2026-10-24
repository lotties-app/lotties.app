import { createContext, useContext } from 'react';
import { useLocation } from 'react-router-dom';

/** Where the board is mounted: `/hub/board` in the app, `/dev/board` in the developer preview. */
export const BoardBaseContext = createContext('/hub/board');

/** URL parameters that belong to one screen and are not carried to the next link. */
const TRANSIENT = ['panel'];

/**
 * Links inside the board that keep the current view and filters (they live in the query string):
 * an item's drawer (`/hub/board/<id>`) and the list without a drawer.
 */
export function useBoardLinks() {
  const base = useContext(BoardBaseContext);
  const { search } = useLocation();
  const params = new URLSearchParams(search);
  for (const name of TRANSIENT) params.delete(name);
  const query = params.toString();
  const suffix = query ? `?${query}` : '';
  return {
    base,
    list: () => `${base}${suffix}`,
    item: (id: string) => `${base}/${encodeURIComponent(id)}${suffix}`,
  };
}
