import { useSyncExternalStore } from 'react';

function subscribe(listener: () => void) {
  window.addEventListener('online', listener);
  window.addEventListener('offline', listener);
  return () => {
    window.removeEventListener('online', listener);
    window.removeEventListener('offline', listener);
  };
}

const getSnapshot = () => navigator.onLine !== false;

/** The browser's online flag, re-rendering on `online` / `offline` events. */
export function useOnline(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => true);
}
