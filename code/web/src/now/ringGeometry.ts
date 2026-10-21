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
