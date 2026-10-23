import { useEffect, useSyncExternalStore } from 'react';

/*
 * Whether a screen shows the running timers in its own page flow (the "Running now" cards of the
 * Now screen). While one does, the floating mini timer bar stays away: the same timers twice would
 * only cover content. A tiny counted claim, so a remount never leaves the bar hidden.
 */

let claims = 0;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const snapshot = () => claims > 0;

/** Marks the timers as shown inline while the calling component is mounted. */
export function useClaimInlineTimers(): void {
  useEffect(() => {
    claims += 1;
    emit();
    return () => {
      claims -= 1;
      emit();
    };
  }, []);
}

/** True while some mounted screen shows the running timers itself. */
export function useInlineTimersShown(): boolean {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
