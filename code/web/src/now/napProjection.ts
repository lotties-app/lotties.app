import type { BabyEvent, EventType } from '../db/models';
import { readBasis } from '../predictions/predictionModel';
import { effectiveDurationMs } from '../timers/pauseMath';
import { MINUTE_MS, sleepSessionKind, typeIdsForKey } from './eventFacts';
import { dayFrame } from './ringGeometry';

/*
 * The naps still likely today after the server's next nap window, as estimates for the day ring
 * and the ruler (docs/DESIGN.md "Now: rhythm details", upcoming naps). Pure, language-free, and
 * built only from numbers the app already has: the server's sleep prediction (its window shape,
 * its basis gap, its typical length), the overtired wake window as a fallback gap, the bedtime
 * window, and the baby's own recent naps (their median length by part of the day, and how many
 * she had on her recent days). No age table and no new rule of thumb: with too little data
 * (fewer than three recent naps, or no prediction) nothing is projected and only the server's
 * window shows. Never past midnight, never into the bedtime window, at most three projected naps.
 */

/** Fewer finished recent naps than this: no projection. */
export const MIN_RECENT_NAPS = 3;
/** Naps of one part of the day needed before their own median is used. */
export const MIN_PART_NAPS = 3;
/** Projected naps after the server's window (or after the running nap). */
export const MAX_PROJECTED = 3;

export interface ProjectionPrediction {
  nextStart: { earliest: string; expected: string; latest: string };
  basis: Record<string, unknown>;
  expectedDuration?: { minutes: number } | null;
}

export interface ProjectionInput {
  events: readonly BabyEvent[];
  types: readonly EventType[];
  now: Date;
  /** What the baby is doing now. */
  state:
    | { kind: 'awake'; since: string }
    | { kind: 'asleep'; since: string; sleepKind: 'nap' | 'night' }
    | { kind: 'other' };
  /** The server's sleep prediction (only while its window is shown, not skipped). */
  prediction?: ProjectionPrediction | null;
  /** The overtired wake window limit (minutes), the gap when the basis has none. */
  wakeWindowMinutes?: number | null;
  bedTime?: { earliest: string; latest: string } | null;
}

export interface ProjectedWindow {
  /** 1 for the first projected nap, then 2, 3. */
  index: number;
  earliest: number;
  expected: number;
  latest: number;
}

export interface NapProjection {
  /** While a nap runs: when she likely wakes (never before now). */
  wake: { from: number; at: number } | null;
  windows: ProjectedWindow[];
  /** The numbers behind the estimate, for the details. */
  basis: { gapKind: 'awake' | 'start'; gapMinutes: number; napMinutes: number };
}

const median = (values: readonly number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/** Part of the day of a local instant, as the prescriptions' day parts split it. */
function partOf(ms: number): 'morning' | 'afternoon' | 'evening' | 'night' {
  const hour = new Date(ms).getHours();
  if (hour >= 22 || hour < 5) return 'night';
  if (hour >= 18) return 'evening';
  if (hour >= 12) return 'afternoon';
  return 'morning';
}

interface Nap {
  start: number;
  minutes: number;
}

function recentNaps(input: ProjectionInput): { finished: Nap[]; today: number } {
  const sleepIds = typeIdsForKey(input.types, 'sleep');
  const nowMs = input.now.getTime();
  const frame = dayFrame(input.now);
  const finished: Nap[] = [];
  let today = 0;
  for (const event of input.events) {
    if (event.deletedAt !== null || !sleepIds.has(event.typeId)) continue;
    if (sleepSessionKind(event) !== 'nap') continue;
    const start = Date.parse(event.startedAt);
    if (start > nowMs) continue;
    if (start >= frame.start) today += 1;
    if (event.endedAt === null || Date.parse(event.endedAt) > nowMs) continue;
    finished.push({ start, minutes: effectiveDurationMs(event, input.now) / MINUTE_MS });
  }
  return { finished, today };
}

/** Most naps she had on one of her recent days before today, or `null` without a past day. */
function napsPerDayCap(naps: readonly Nap[], now: Date): number | null {
  const todayStart = dayFrame(now).start;
  const perDay = new Map<number, number>();
  for (const nap of naps) {
    if (nap.start >= todayStart) continue;
    const day = dayFrame(new Date(nap.start)).start;
    perDay.set(day, (perDay.get(day) ?? 0) + 1);
  }
  return perDay.size > 0 ? Math.max(...perDay.values()) : null;
}

/** The likely remaining naps of today, or `null` when there is too little to go on. */
export function projectNaps(input: ProjectionInput): NapProjection | null {
  const prediction = input.prediction;
  if (!prediction || input.state.kind === 'other') return null;
  if (input.state.kind === 'asleep' && input.state.sleepKind !== 'nap') return null;
  const { finished, today } = recentNaps(input);
  if (finished.length < MIN_RECENT_NAPS) return null;

  const basis = readBasis(prediction.basis);
  const gapKind: 'awake' | 'start' = basis?.kind === 'StartInterval' ? 'start' : 'awake';
  const gapMinutes = basis?.medianGapMinutes ?? input.wakeWindowMinutes ?? null;
  if (gapMinutes === null || !(gapMinutes > 0)) return null;
  const gap = gapMinutes * MINUTE_MS;

  const overall = median(finished.map((nap) => nap.minutes));
  const fallback = prediction.expectedDuration?.minutes ?? overall;
  const napMinutesAt = (ms: number) => {
    const part = partOf(ms);
    const same = finished.filter((nap) => partOf(nap.start) === part);
    return same.length >= MIN_PART_NAPS ? median(same.map((nap) => nap.minutes)) : fallback;
  };

  const earliest = Date.parse(prediction.nextStart.earliest);
  const expected = Date.parse(prediction.nextStart.expected);
  const latest = Date.parse(prediction.nextStart.latest);
  if (![earliest, expected, latest].every(Number.isFinite)) return null;
  const before = Math.max(0, expected - earliest);
  const after = Math.max(0, latest - expected);

  const nowMs = input.now.getTime();
  const frame = dayFrame(input.now);
  const bedFrom = input.bedTime ? Date.parse(input.bedTime.earliest) : Infinity;
  const cap = napsPerDayCap(finished, input.now);

  let wake: NapProjection['wake'] = null;
  // The start of the latest nap (real or expected) and its likely end, the cursor of the loop.
  let lastStart: number;
  let lastEnd: number;
  let upcoming: number;
  if (input.state.kind === 'asleep') {
    lastStart = Date.parse(input.state.since);
    lastEnd = Math.max(nowMs, lastStart + napMinutesAt(lastStart) * MINUTE_MS);
    wake = { from: nowMs, at: lastEnd };
    upcoming = 0;
  } else {
    // The server's window is the first upcoming nap; the projection continues after it.
    lastStart = expected;
    lastEnd = expected + napMinutesAt(expected) * MINUTE_MS;
    upcoming = 1;
  }
  const napMinutes = Math.round(napMinutesAt(lastStart));
  const remaining = cap === null ? MAX_PROJECTED : Math.max(0, cap - today - upcoming);
  const limit = Math.min(MAX_PROJECTED, remaining);

  const windows: ProjectedWindow[] = [];
  while (windows.length < limit) {
    const next = gapKind === 'awake' ? lastEnd + gap : Math.max(lastStart + gap, lastEnd);
    const window = { earliest: next - before, expected: next, latest: next + after };
    if (window.earliest >= frame.end || window.earliest >= bedFrom) break;
    windows.push({
      index: windows.length + 1,
      earliest: window.earliest,
      expected: window.expected,
      latest: Math.min(window.latest, frame.end),
    });
    lastStart = next;
    lastEnd = next + napMinutesAt(next) * MINUTE_MS;
  }

  if (windows.length === 0 && wake === null) return null;
  return {
    wake: wake && wake.at < frame.end ? wake : null,
    windows,
    basis: { gapKind, gapMinutes, napMinutes },
  };
}
