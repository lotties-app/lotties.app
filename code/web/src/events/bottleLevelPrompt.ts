import { useSyncExternalStore } from 'react';
import type { BabyEvent } from '../db/models';
import { preparedMl } from './bottleAmounts';
import { readSegments, SEGMENTS_KEY } from './bottleSegments';
import { getOwn } from '../util/ownProperty';

/*
 * "How much is left in the bottle?" right after a bottle is paused (docs/design/20-feeding-amounts.md
 * section 5). The pause itself is already saved; the question is optional and one tap. It outlives
 * the card, pill or sheet that paused the bottle, so it lives in this tiny store and is drawn by
 * `BottleLevelPromptHost` (mounted once in the app shell).
 */

export interface BottleLevelPrompt {
  /** Changes with every prompt (React key). */
  id: number;
  eventId: string;
  /** Prepared amount (ml), or `null`: then only the ml stepper is offered. */
  preparedMl: number | null;
  /** The level the stretch started at: no choice above it. */
  ceilingMl: number | null;
  /** How many stretches the bottle has with the one just closed (the answer fills that one). */
  count: number;
}

let current: BottleLevelPrompt | null = null;
let counter = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

/**
 * Asks for the level of a bottle that was just paused: only a bottle whose pause closed a stretch
 * with an unknown level (`pauseTimer` does that for the built-in feeding type). Anything else is
 * ignored.
 */
export function askBottleLevel(event: BabyEvent): void {
  const segments = readSegments(event.payload);
  const last = segments[segments.length - 1];
  if (
    event.endedAt !== null ||
    getOwn(event.payload, 'method') !== 'bottle' ||
    typeof getOwn(event.payload, SEGMENTS_KEY) !== 'string' ||
    !last ||
    last.leftMl !== null
  ) {
    return;
  }
  counter += 1;
  current = {
    id: counter,
    eventId: event.id,
    preparedMl: preparedMl(event.payload) ?? null,
    ceilingMl: last.startMl,
    count: segments.length,
  };
  emit();
}

/** Closes the question (`id`: only if it is still that one). */
export function dismissBottleLevel(id?: number): void {
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

export function useBottleLevelPrompt(): BottleLevelPrompt | null {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => null,
  );
}
