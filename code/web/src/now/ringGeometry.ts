import type { BabyEvent, EventType } from '../db/models';
import { effectiveMsInWindow } from '../timers/pauseMath';
import { MINUTE_MS, isSleepKind, sleepSessionKind, typeIdsForKey } from './eventFacts';

/*
 * Geometry of the day rhythm ring: a 24 h clock face where midnight is at the top and time runs
 * clockwise. Pure and language-free. Angles are degrees in [0, 360]; every span is clipped to the
 * local day, so a sleep that began yesterday starts at the top and a window that crosses the end
 * of the day is cut there. The day length is measured, not assumed (a DST day has 23 or 25 h).
 */

export interface DayFrame {
  /** Local midnight that starts the day (ms). */
  start: number;
  /** Local midnight that starts the next day (ms). */
  end: number;
}

/** The local day containing `date`. */
export function dayFrame(date: Date): DayFrame {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const end = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
  return { start: start.getTime(), end: end.getTime() };
}

/** Angle of an instant on the face, clamped to the day: midnight 0, noon 180, next midnight 360. */
export function angleOf(ms: number, frame: DayFrame): number {
  const ratio = (ms - frame.start) / (frame.end - frame.start);
  return Math.min(1, Math.max(0, ratio)) * 360;
}

export interface ArcSpan {
  from: number;
  to: number;
}

/**
 * The part of `[fromMs, toMs]` that falls inside the day, as angles. Empty when the span does not
 * touch the day or has no length. A span that crosses midnight is cut at the day edge, so it
 * appears as one arc ending at 360 (or starting at 0), never as one that wraps.
 */
export function spanAngles(fromMs: number, toMs: number, frame: DayFrame): ArcSpan[] {
  const from = Math.max(fromMs, frame.start);
  const to = Math.min(toMs, frame.end);
  if (!(to > from)) return [];
  return [{ from: angleOf(from, frame), to: angleOf(to, frame) }];
}

/**
 * Like `spanAngles` for a window that may cross midnight and should be drawn on both sides of the
 * top of the face: the part after the next midnight is wrapped to the start of the face.
 */
export function wrappedSpanAngles(fromMs: number, toMs: number, frame: DayFrame): ArcSpan[] {
  const length = frame.end - frame.start;
  return [...spanAngles(fromMs, toMs, frame), ...spanAngles(fromMs - length, toMs - length, frame)];
}

export interface Point {
  x: number;
  y: number;
}

/** Point on a circle: angle 0 is the top, angles grow clockwise. */
export function polar(cx: number, cy: number, radius: number, angle: number): Point {
  const radians = ((angle - 90) * Math.PI) / 180;
  return { x: cx + radius * Math.cos(radians), y: cy + radius * Math.sin(radians) };
}

const round = (value: number) => Math.round(value * 100) / 100;

/** SVG path of the arc from angle `from` to `to` (clockwise), or `''` for an empty arc. */
export function arcPath(cx: number, cy: number, radius: number, from: number, to: number): string {
  const sweep = to - from;
  if (sweep <= 0) return '';
  // A full circle cannot be one SVG arc (start equals end): stop a hair short.
  const end = sweep >= 359.99 ? from + 359.99 : to;
  const a = polar(cx, cy, radius, from);
  const b = polar(cx, cy, radius, end);
  const large = end - from > 180 ? 1 : 0;
  return `M ${round(a.x)} ${round(a.y)} A ${radius} ${radius} 0 ${large} 1 ${round(b.x)} ${round(b.y)}`;
}

/**
 * SVG path of a ring sector (a thick arc with square ends) between `inner` and `outer` radii, from
 * angle `from` to `to` clockwise, or `''` for an empty one. Filled and outlined like a block of the
 * Day ribbon, so a nap can be a tint with a rim and the nap window a band with a dashed edge.
 */
export function sectorPath(
  cx: number,
  cy: number,
  inner: number,
  outer: number,
  from: number,
  to: number,
): string {
  const sweep = to - from;
  if (sweep <= 0) return '';
  const end = sweep >= 359.99 ? from + 359.99 : to;
  const large = end - from > 180 ? 1 : 0;
  const a = polar(cx, cy, outer, from);
  const b = polar(cx, cy, outer, end);
  const c = polar(cx, cy, inner, end);
  const d = polar(cx, cy, inner, from);
  return [
    `M ${round(a.x)} ${round(a.y)}`,
    `A ${outer} ${outer} 0 ${large} 1 ${round(b.x)} ${round(b.y)}`,
    `L ${round(c.x)} ${round(c.y)}`,
    `A ${inner} ${inner} 0 ${large} 0 ${round(d.x)} ${round(d.y)}`,
    'Z',
  ].join(' ');
}

/** Shortest distance in degrees between two angles of the face (0 and 360 are the same point). */
export function angleDistance(a: number, b: number): number {
  const diff = Math.abs(a - b) % 360;
  return Math.min(diff, 360 - diff);
}

export interface RingLabelCandidate {
  key: string;
  angle: number;
  /** Higher wins when two labels would be too close. */
  priority: number;
}

export interface LabelPlacement {
  /** Two kept labels are never closer than this (degrees along the face). */
  minDegrees: number;
  /** Angles of marks a label must keep clear of (the "now" marker), by the same distance. */
  blockers?: readonly number[];
}

/**
 * Which labels around the face to draw: the most important first, each kept only when it is at
 * least `minDegrees` away from every label kept before it and from every blocker; the less important
 * one of a close pair is dropped, never moved, so a label always names the place it sits at. Pure;
 * the kept labels come back in angle order.
 */
export function placeRingLabels<T extends RingLabelCandidate>(
  candidates: readonly T[],
  { minDegrees, blockers = [] }: LabelPlacement,
): T[] {
  const ordered = [...candidates].sort((a, b) => b.priority - a.priority || a.angle - b.angle);
  const kept: T[] = [];
  for (const candidate of ordered) {
    const clear = (angle: number) => angleDistance(candidate.angle, angle) >= minDegrees;
    if (blockers.every(clear) && kept.every((label) => clear(label.angle))) kept.push(candidate);
  }
  return kept.sort((a, b) => a.angle - b.angle);
}

export type RingSpanKind = 'nap' | 'night' | 'waking';

export interface RingSpan extends ArcSpan {
  id: string;
  kind: RingSpanKind;
}

export interface RingMarker {
  id: string;
  kind: 'wake' | 'bed';
  angle: number;
  /** The instant (ISO) for the label. */
  at: string;
}

export interface RingWindow extends ArcSpan {
  id: string;
  /** The whole predicted window (ISO), for the labels. */
  earliest: string;
  latest: string;
}

export interface RingModel {
  frame: DayFrame;
  spans: RingSpan[];
  markers: RingMarker[];
  windows: RingWindow[];
  nowAngle: number;
  /** Minutes slept inside the day so far (naps and night sleep, running sleep until now). */
  sleptMinutes: number;
}

export interface RingInput {
  events: readonly BabyEvent[];
  types: readonly EventType[];
  now: Date;
  /** Predicted sleep windows (ISO instants). */
  windows?: readonly { earliest: string; latest: string }[];
}

/**
 * The ring of today's sleep so far: sleep spans (naps, night sleep, night wakings) clipped to the
 * day, the wake-up and bedtime markers, the predicted windows still ahead inside the day and the
 * angle of "now".
 */
export function buildRing({ events, types, now, windows = [] }: RingInput): RingModel {
  const frame = dayFrame(now);
  const nowMs = now.getTime();
  const sleepIds = typeIdsForKey(types, 'sleep');
  const spans: RingSpan[] = [];
  const markers: RingMarker[] = [];
  let sleptMinutes = 0;
  const insideDay = (ms: number) => ms >= frame.start && ms < frame.end;

  for (const event of events) {
    if (event.deletedAt !== null || !sleepIds.has(event.typeId)) continue;
    const begin = Date.parse(event.startedAt);
    if (begin > nowMs) continue;
    const finish = event.endedAt === null ? nowMs : Math.min(Date.parse(event.endedAt), nowMs);
    const waking = isSleepKind(event, 'night_waking');
    const session = sleepSessionKind(event);

    if (isSleepKind(event, 'bed_time') && insideDay(begin)) {
      markers.push({
        id: event.id,
        kind: 'bed',
        angle: angleOf(begin, frame),
        at: event.startedAt,
      });
    }
    if (session === null && !waking) continue;

    for (const part of spanAngles(begin, finish, frame)) {
      spans.push({ ...part, id: event.id, kind: waking ? 'waking' : (session ?? 'nap') });
    }
    if (session === null) continue;
    sleptMinutes += Math.round(
      effectiveMsInWindow(event, frame.start, Math.min(finish, frame.end), nowMs) / MINUTE_MS,
    );
    if (session === 'night' && event.endedAt !== null && insideDay(finish)) {
      markers.push({
        id: `${event.id}-wake`,
        kind: 'wake',
        angle: angleOf(finish, frame),
        at: event.endedAt,
      });
    }
  }

  const upcoming: RingWindow[] = [];
  windows.forEach((window, index) => {
    const from = Date.parse(window.earliest);
    const to = Date.parse(window.latest);
    if (!(to > nowMs)) return;
    for (const part of spanAngles(Math.max(from, nowMs), to, frame)) {
      upcoming.push({
        ...part,
        id: `window-${index}`,
        earliest: window.earliest,
        latest: window.latest,
      });
    }
  });

  return {
    frame,
    spans: spans.sort((a, b) => a.from - b.from),
    markers: markers.sort((a, b) => a.angle - b.angle),
    windows: upcoming,
    nowAngle: angleOf(nowMs, frame),
    sleptMinutes,
  };
}

/** The hours named around the face. */
export const RING_HOURS = [0, 6, 12, 18] as const;
/**
 * Least distance (degrees) between an hour label and the "now" marker or another label: at the
 * ring's size a 12 degree gap keeps a two-digit label clear of the marker's dot.
 */
export const RING_LABEL_CLEARANCE = 12;

export interface RingHourLabel extends RingLabelCandidate {
  hour: number;
}

/** The hour labels to draw: the four fixed hours, minus any too close to the "now" marker. */
export function ringHourLabels(nowAngle: number | null): RingHourLabel[] {
  return placeRingLabels(
    RING_HOURS.map((hour) => ({ key: `hour-${hour}`, hour, angle: hour * 15, priority: 1 })),
    {
      minDegrees: RING_LABEL_CLEARANCE,
      blockers: nowAngle === null ? [] : [nowAngle],
    },
  );
}

export type RingLegendKey = RingSpanKind | 'window' | 'projected' | 'wake' | 'bedtime' | 'now';

/** The estimates drawn besides today's sleep and the server's window. */
export interface RingEstimates {
  projected?: boolean;
  wake?: boolean;
  bedtime?: boolean;
}

/** The keys of the legend under the ring: only what the ring draws, in a fixed order. */
export function ringLegendKeys(
  ring: Pick<RingModel, 'spans' | 'windows'>,
  estimates: RingEstimates = {},
): RingLegendKey[] {
  const kinds = new Set(ring.spans.map((span) => span.kind));
  const keys: RingLegendKey[] = (['night', 'nap', 'waking'] as const).filter((kind) =>
    kinds.has(kind),
  );
  if (ring.windows.length > 0) keys.push('window');
  if (estimates.projected) keys.push('projected');
  if (estimates.wake) keys.push('wake');
  if (estimates.bedtime) keys.push('bedtime');
  keys.push('now');
  return keys;
}
