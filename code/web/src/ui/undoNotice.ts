import { useSyncExternalStore } from 'react';

/*
 * A small "X deleted · Undo" notice for settings-style deletes (prescriptions, medications). It
 * outlives the sheet or list row that raised it, so it lives in this tiny store and is drawn by
 * `UndoSnackbar` (mounted once in the app shell), like the deleted-event notice.
 */

export interface UndoNotice {
  /** Changes with every notice (React key, stale timers). */
  id: number;
  message: string;
  /** Restores what was deleted; rejects with the reason shown to the parent. */
  undo: () => Promise<void>;
}

let current: UndoNotice | null = null;
let counter = 0;
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((listener) => listener());

/** Shows the notice (replaces the previous one). */
export function announceUndo(message: string, undo: () => Promise<void>): void {
  counter += 1;
  current = { id: counter, message, undo };
  emit();
}

/** Hides the notice (`id`: only if it is still that one). */
export function dismissUndoNotice(id?: number): void {
  if (current === null || (id !== undefined && current.id !== id)) return;
  current = null;
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useUndoNotice(): UndoNotice | null {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => null,
  );
}
