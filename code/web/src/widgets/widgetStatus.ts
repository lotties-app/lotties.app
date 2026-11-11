import { useSyncExternalStore } from 'react';

/** What the last widget snapshot write did, for Hub > About (the widget cannot be inspected on the device otherwise). */
export type WidgetStatus =
  | { state: 'waiting' }
  | { state: 'working'; step: 'reading' | 'sending' }
  | { state: 'ok'; at: string; detail?: string }
  | { state: 'error'; message: string };

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

let refresher: ((force: boolean) => Promise<void>) | undefined;

/**
 * `WidgetSync` registers how to rebuild and send the snapshot now (`force`: even when it did not change); Hub > About
 * calls it from a button, a silent push after its sync.
 */
export function setWidgetRefresher(fn: ((force: boolean) => Promise<void>) | undefined): void {
  refresher = fn;
}

export async function refreshWidgetNow(): Promise<void> {
  if (!refresher) {
    setWidgetStatus({ state: 'error', message: 'widget sync is not running' });
    return;
  }
  await refresher(true);
}

/**
 * Rebuilds the snapshot now and writes it only when it changed (each write reloads the widgets, which costs iOS widget
 * budget); resolves when done. `false` when the widget sync is not running.
 */
export async function flushWidgetSnapshot(): Promise<boolean> {
  if (!refresher) return false;
  await refresher(false);
  return true;
}
