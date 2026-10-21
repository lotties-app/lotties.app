import { useState } from 'react';
import { useEventsStartedSince, useRunningEvents } from '../db/hooks';
import type { BabyEvent } from '../db/models';
import { useNow } from '../events/time';
import { eventMatchesPreset, formatPresetStatus, presetStatus, runningSince } from './status';
import type { Preset } from './types';

const DAY_MS = 24 * 3_600_000;

/**
 * Events the preset status lines need: the last 24 hours plus every running timer (a timer can be
 * older). `undefined` while loading.
 */
export function usePresetEvents(babyId: string): BabyEvent[] | undefined {
  const [since] = useState(() => new Date(Date.now() - DAY_MS).toISOString());
  const recent = useEventsStartedSince(babyId, since);
  const running = useRunningEvents(babyId);
  if (!recent || !running) return undefined;
  const ids = new Set(recent.map((e) => e.id));
  return [...recent, ...running.filter((e) => !ids.has(e.id))];
}

export interface PresetState {
  status: string;
  /** The preset's own running timer (oldest), if one runs. */
  running: BabyEvent | undefined;
}

/** Status line and running timer of each preset, refreshed every minute. */
export function usePresetStates(events: readonly BabyEvent[]) {
  const now = new Date(useNow(60_000));
  return (preset: Preset): PresetState => {
    if (preset.mode === 'link') return { status: '', running: undefined };
    const status = presetStatus(preset, events, now);
    if (status !== 'running')
      return { status: formatPresetStatus(status, now), running: undefined };
    const since = runningSince(preset, events);
    const running = events.find(
      (e) => e.endedAt === null && e.startedAt === since && eventMatchesPreset(preset, e),
    );
    return { status: formatPresetStatus(status, now, since), running };
  };
}
