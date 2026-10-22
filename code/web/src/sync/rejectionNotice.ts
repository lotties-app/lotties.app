import { useSyncExternalStore } from 'react';

/*
 * The one-time notice for changes the server refused because of the user's role: a Caregiver's
 * change to someone else's entry (403 `event_not_owned`, the change was dropped and the entry put
 * back) or a write the role no longer allows (403 without a code, e.g. demoted to Viewer while
 * offline: the change is kept in Settings > Sync). The sync engine raises it; the shell draws it
 * once (`RejectedChangeSnackbar`); a later rejection replaces it. A third kind: a change to a
 * doctor's suggestion that was already decided (the stored proposal was put back).
 */

export type RejectionKind = 'notOwned' | 'role' | 'proposalDecided';

export interface RejectionNotice {
  /** Changes with every notice (React key). */
  id: number;
  kind: RejectionKind;
}

let current: RejectionNotice | null = null;
let counter = 0;
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((listener) => listener());

export function announceRejection(kind: RejectionKind): void {
  counter += 1;
  current = { id: counter, kind };
  emit();
}

/** Hides the notice (`id`: only if it is still that one). */
export function dismissRejectionNotice(id?: number): void {
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

/** The notice waiting to be shown, if any. */
export function currentRejectionNotice(): RejectionNotice | null {
  return current;
}

export function useRejectionNotice(): RejectionNotice | null {
  return useSyncExternalStore(subscribe, currentRejectionNotice, () => null);
}
