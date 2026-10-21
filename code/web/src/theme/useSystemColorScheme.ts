import { useSyncExternalStore } from 'react';
import type { ResolvedMode } from './tokens';

const LIGHT_QUERY = '(prefers-color-scheme: light)';

function lightQuery(): MediaQueryList | null {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(LIGHT_QUERY)
    : null;
}

function subscribe(onChange: () => void) {
  const query = lightQuery();
  query?.addEventListener('change', onChange);
  return () => query?.removeEventListener('change', onChange);
}

/** Only an explicit light preference gives light; no preference or no support gives dark. */
export function useSystemColorScheme(): ResolvedMode {
  const prefersLight = useSyncExternalStore(
    subscribe,
    () => lightQuery()?.matches ?? false,
    () => false,
  );
  return prefersLight ? 'light' : 'dark';
}
