import { useEffect, useSyncExternalStore } from 'react';
import type { EventType } from '../db/models';
import type { CatchUp } from './catchUp';

/*
 * The "Since you last looked" hand-over lives behind a header button (docs/design/21-hub.md), but
 * its period belongs to the Now screen (`useHandover`: read when Now shows the baby, stored when it
 * leaves). So the Now screen offers its catch-up here while it shows one, and the header button
 * reads it: the same conditions as the old inline card, no second "last seen" clock.
 */

export interface CatchUpOffer {
  babyId: string;
  babyName: string;
  catchUp: CatchUp;
  types: readonly EventType[];
  /** "Got it": marks it seen (the next catch-up starts now). */
  acknowledge: () => void;
}

let current: CatchUpOffer | null = null;
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

const snapshot = () => current;

/** Offers the catch-up to the header while the calling screen is mounted (`null`: nothing new). */
export function useOfferCatchUp(offer: CatchUpOffer | null): void {
  useEffect(() => {
    if (!offer) return;
    current = offer;
    emit();
    return () => {
      if (current === offer) {
        current = null;
        emit();
      }
    };
  }, [offer]);
}

/** The catch-up a mounted screen offers, or `null`. */
export function useCatchUpOffer(): CatchUpOffer | null {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
