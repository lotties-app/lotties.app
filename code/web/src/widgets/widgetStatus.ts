import { useSyncExternalStore } from 'react';

/** What the last widget snapshot write did, for Hub > About (the widget cannot be inspected on the device otherwise). */
export type WidgetStatus =
  { state: 'waiting' } | { state: 'ok'; at: string } | { state: 'error'; message: string };

let current: WidgetStatus = { state: 'waiting' };
const listeners = new Set<() => void>();

export function setWidgetStatus(next: WidgetStatus): void {
  current = next;
  listeners.forEach((listener) => listener());
}

export function useWidgetStatus(): WidgetStatus {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
  );
}

export const errorText = (error: unknown): string =>
  (error instanceof Error ? error.message : String(error)).slice(0, 160);
