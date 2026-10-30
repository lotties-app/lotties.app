import { useSyncExternalStore } from 'react';
import type { BabyEvent } from '../db/models';

/*
 * The "event deleted, Undo" notice. Deleting is a soft delete without a confirmation; the notice
 * outlives the sheet or row that deleted the event, so it lives in this tiny store and is drawn by
 * `DeletedEventSnackbar` (mounted once in the app shell).
 */

export interface DeletedNotice {
  /** Changes with every notice (React key, stale timers). */
  id: number;
  event: BabyEvent;
  /** Localized name of what was deleted ("Bottle", "Nap"). */
  name: string;
  /** A night's automatic wake-up deleted with it (Undo restores both). */
  wakeUp: BabyEvent | null;
}

let current: DeletedNotice | null = null;
let counter = 0;
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((listener) => listener());

/** Shows the notice for a just deleted event (replaces the previous one). */
export function announceEventDeleted(
  event: BabyEvent,
  name: string,
  wakeUp: BabyEvent | null = null,
): void {
  counter += 1;
  current = { id: counter, event, name, wakeUp };
  emit();
}

/** Hides the notice (`id`: only if it is still that one). */
export function dismissDeletedNotice(id?: number): void {
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

export function useDeletedNotice(): DeletedNotice | null {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => null,
  );
}
