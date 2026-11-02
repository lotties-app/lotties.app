import type { BabyEvent, EventPayload } from '../db/models';
import {
  PAUSE_COUNT_KEY,
  PAUSED_AT_KEY,
  PAUSED_SECONDS_KEY,
  MAX_PAUSE_COUNT,
  MAX_PAUSED_SECONDS,
  readPause,
} from '../timers/pauseMath';
import { getOwn, setOwn, withoutOwn } from '../util/ownProperty';
import { DRUNK_KEY, PREPARED_KEY } from './bottleAmounts';
import {
  MAX_LEVEL_ML,
  MAX_SEGMENTS,
  MAX_SEGMENT_SECONDS,
  SEGMENTS_KEY,
  formatSegments,
  historyTimeProblem,
  parseSegments,
  readSegments,
  segmentDrunkMl,
  segmentEnd,
  type BottleSegment,
} from './bottleSegments';

/*
 * The history of a timed bottle (docs/design/44-bottle-history.md): start, each pause with the
 * level left, each resume, the end, built from `segments` with times (`bottleSegments.ts`). The
 * history is the source of the pause totals: `historyTotals` derives `pause_count` and
 * `paused_seconds` from it (same as the API's `BottleHistory.Totals`, both read
 * `bottleSegmentsVectors.json`) and `withHistoryTotals` writes them on every save. The row edits
 * (time, level, add and remove a pause) return a new payload; the drunk total follows the last
 * level through the sheet's drunk field. Pure.
 */

type Times = Pick<BabyEvent, 'startedAt' | 'endedAt'>;
type Bottle = Times & Pick<BabyEvent, 'payload'>;

const MS = 1000;

/** Whole seconds from `startedAt` to `endedAt` (never negative). */
export function lengthSeconds(startedAt: string, endedAt: string): number {
  return Math.max(0, Math.floor((Date.parse(endedAt) - Date.parse(startedAt)) / MS));
}

const lengthOf = (times: Times) =>
  times.endedAt === null ? null : lengthSeconds(times.startedAt, times.endedAt);

export interface HistoryTotals {
  pauseCount: number;
  pausedSeconds: number;
}

const allTimed = (segments: readonly BottleSegment[]) =>
  segments.every((segment) => segment.begin !== undefined);

/** Seconds of the pauses between the stretches (a timed history). */
function pausesBetween(segments: readonly BottleSegment[]): number {
  let sum = 0;
  for (let i = 1; i < segments.length; i += 1) {
    sum += (segments[i].begin ?? 0) - (segmentEnd(segments[i - 1]) ?? 0);
  }
  return sum;
}

/**
 * The pause totals of a history where every stretch has a time and the times keep the rules, else
 * `null`. Ended (`lengthSeconds`): the pauses between stretches, plus one from the last stretch's
 * end to the end when it stopped while paused. Running and `paused`: the pauses between stretches.
 * Running and drinking: every stretch was followed by a pause; the last one's resume is not in the
 * history, so its length is what `pausedSeconds` says beyond the others (never below 0).
 */
export function historyTotals(
  segments: readonly BottleSegment[],
  length: number | null,
  paused: boolean,
  pausedSeconds: number,
): HistoryTotals | null {
  if (segments.length === 0 || !allTimed(segments)) return null;
  if (historyTimeProblem(segments, length) !== null) return null;
  const between = pausesBetween(segments);
  const n = segments.length;
  const lastEnd = segmentEnd(segments[n - 1]) ?? 0;
  let count: number;
  let seconds: number;
  if (length !== null && length > lastEnd) [count, seconds] = [n, between + (length - lastEnd)];
  else if (length !== null || paused) [count, seconds] = [n - 1, between];
  else [count, seconds] = [n, Math.max(between, pausedSeconds)];
  return {
    pauseCount: Math.min(count, MAX_PAUSE_COUNT),
    pausedSeconds: Math.min(seconds, MAX_PAUSED_SECONDS),
  };
}

/** `payload` with `pause_count` and `paused_seconds` recomputed from its history (unchanged without one). */
export function withHistoryTotals(payload: EventPayload, times: Times): EventPayload {
  const segments = parseSegments(getOwn(payload, SEGMENTS_KEY));
  if (segments === null) return payload;
  const pause = readPause(payload);
  const paused = times.endedAt === null && pause.pausedAt !== null;
  const totals = historyTotals(segments, lengthOf(times), paused, pause.pausedSeconds);
  if (
    totals === null ||
    (totals.pauseCount === pause.count && totals.pausedSeconds === pause.pausedSeconds)
  ) {
    return payload;
  }
  const next: EventPayload = { ...payload };
  setOwn<unknown>(next, PAUSE_COUNT_KEY, totals.pauseCount);
  setOwn<unknown>(next, PAUSED_SECONDS_KEY, totals.pausedSeconds);
  return next;
}

/**
 * Whether `after` only adds to the history `before` (API `BottleHistory.OnlyExtends`): what a
 * pause, a level answer or the stop write on someone else's running bottle. Every stretch but the
 * last keeps its drinking time and begin, none is removed; levels may change. Unreadable or absent
 * before, or absent after: allowed.
 */
export function historyOnlyExtends(before: unknown, after: unknown): boolean {
  const old = parseSegments(before);
  if (old === null || typeof after !== 'string') return true;
  const next = parseSegments(after);
  if (next === null || next.length < old.length) return false;
  return old
    .slice(0, -1)
    .every((s, i) => s.seconds === next[i].seconds && s.begin === next[i].begin);
}

export type HistoryRowKind = 'start' | 'pause' | 'resume' | 'end';

export interface HistoryRow {
  kind: HistoryRowKind;
  /** Stretch index: a start or resume begins stretch `index`, a pause or the end closes it. */
  index: number;
  /** Clock time (ms since epoch), `null` when unknown (bottles written before times). */
  atMs: number | null;
  /** Level in the bottle at that moment (ml), `null` when unknown. */
  levelMl: number | null;
  /** What she drank since the previous level (pause and end rows), when both levels are known. */
  drunkMl: number | null;
  /** The resume of a running bottle drinking now (its stretch is not stored yet). */
  open?: boolean;
}

/** Whether the bottle runs and is paused now (`paused_at`). */
const isPausedNow = (bottle: Bottle) =>
  bottle.endedAt === null && readPause(bottle.payload).pausedAt !== null;

const preparedLevel = (payload: Readonly<EventPayload>): number | null => {
  const value = getOwn(payload, PREPARED_KEY);
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.floor(Math.min(value, MAX_LEVEL_ML))
    : null;
};

/** The level at the end from the totals: prepared minus drunk (absent drunk: all, so 0). */
function endLevelFromTotals(payload: Readonly<EventPayload>): number | null {
  const prepared = preparedLevel(payload);
  if (prepared === null) return null;
  const drunk = getOwn(payload, DRUNK_KEY);
  const drank = typeof drunk === 'number' && Number.isFinite(drunk) ? drunk : prepared;
  return Math.max(0, prepared - Math.min(prepared, Math.max(0, drank)));
}

/** Whether the last stored stretch closes at the end (stopped while drinking), not at a pause. */
function lastClosesAtEnd(bottle: Bottle, segments: readonly BottleSegment[]): boolean {
  const length = lengthOf(bottle);
  const last = segments[segments.length - 1];
  if (length === null || !last) return false;
  const end = segmentEnd(last);
  return end === null || end >= length;
}

/** When the open stretch of a running bottle drinking now began (seconds), when known. */
function openBegin(bottle: Bottle, segments: readonly BottleSegment[]): number | null {
  if (segments.length === 0) return 0;
  if (!allTimed(segments)) return null;
  const last = segmentEnd(segments[segments.length - 1]) ?? 0;
  const lastPause = Math.max(0, readPause(bottle.payload).pausedSeconds - pausesBetween(segments));
  return last + lastPause;
}

/**
 * The rows of the history, oldest first: start (the prepared level), each pause with the level
 * left and what she drank since, each resume (the level it started at), and the end. A running
 * bottle drinking now ends with its last resume (`open`), a paused one with its pause.
 */
export function historyRows(bottle: Bottle): HistoryRow[] {
  const segments = readSegments(bottle.payload);
  const start = Date.parse(bottle.startedAt);
  const at = (offset: number | null | undefined) =>
    offset === null || offset === undefined ? null : start + offset * MS;
  const n = segments.length;
  const closesAtEnd = lastClosesAtEnd(bottle, segments);
  const rows: HistoryRow[] = [
    {
      kind: 'start',
      index: 0,
      atMs: start,
      levelMl: n > 0 ? segments[0].startMl : preparedLevel(bottle.payload),
      drunkMl: null,
    },
  ];
  segments.forEach((segment, i) => {
    if (!(closesAtEnd && i === n - 1)) {
      rows.push({
        kind: 'pause',
        index: i,
        atMs: at(segmentEnd(segment)),
        levelMl: segment.leftMl,
        drunkMl: segmentDrunkMl(segment),
      });
    }
    const next = segments[i + 1];
    if (next) {
      rows.push({
        kind: 'resume',
        index: i + 1,
        atMs: at(next.begin),
        levelMl: next.startMl,
        drunkMl: null,
      });
    }
  });
  if (bottle.endedAt === null && n > 0 && !isPausedNow(bottle)) {
    rows.push({
      kind: 'resume',
      index: n,
      atMs: at(openBegin(bottle, segments)),
      levelMl: segments[n - 1].leftMl,
      drunkMl: null,
      open: true,
    });
  }
  if (bottle.endedAt !== null) {
    const last = segments[n - 1];
    rows.push({
      kind: 'end',
      index: Math.max(0, n - 1),
      atMs: Date.parse(bottle.endedAt),
      levelMl: last ? last.leftMl : endLevelFromTotals(bottle.payload),
      drunkMl: last && closesAtEnd ? segmentDrunkMl(last) : null,
    });
  }
  return rows;
}

export type HistoryEditProblem = 'order' | 'afterEnd' | 'firstBegin' | 'level' | 'full';

export type HistoryEdit = { payload: EventPayload } | { problem: HistoryEditProblem };

const offsetOf = (bottle: Bottle, atMs: number) =>
  Math.floor((atMs - Date.parse(bottle.startedAt)) / MS);

function withHistory(
  payload: Readonly<EventPayload>,
  segments: readonly BottleSegment[],
): EventPayload {
  if (segments.length === 0) return withoutOwn<unknown>(payload, SEGMENTS_KEY);
  const next: EventPayload = { ...payload };
  setOwn<unknown>(next, SEGMENTS_KEY, formatSegments(segments));
  return next;
}

/**
 * The edited stretches checked as the API will (times and levels), then written on `payload` with
 * its totals recomputed.
 */
function checked(
  bottle: Bottle,
  payload: EventPayload,
  segments: readonly BottleSegment[],
): HistoryEdit {
  if (segments.some((s) => s.seconds < 0 || (s.begin ?? 0) < 0)) return { problem: 'order' };
  if (segments.some((s) => s.seconds > MAX_SEGMENT_SECONDS || (s.begin ?? 0) > MAX_SEGMENT_SECONDS)) {
    return { problem: 'afterEnd' };
  }
  const time = historyTimeProblem(segments, lengthOf(bottle));
  if (time !== null) return { problem: time };
  const prepared = preparedLevel(payload);
  for (let i = 0; i < segments.length; i += 1) {
    const s = segments[i];
    const drunk = segmentDrunkMl(s);
    if (drunk !== null && drunk < 0) return { problem: 'level' };
    if (prepared !== null && [s.startMl, s.leftMl].some((l) => l !== null && l > prepared)) {
      return { problem: 'level' };
    }
  }
  return { payload: withHistoryTotals(withHistory(payload, segments), bottle) };
}

/**
 * The history with the row's time set to `atMs` (whole seconds from the start). A pause moves
 * the end of its stretch; a resume moves the begin of its stretch (its end stays); a stretch
 * without a time takes one, keeping its drinking time. The open pause of a running bottle moves
 * `paused_at` too; the open resume of one drinking now sets the last pause's length.
 */
export function setRowTime(bottle: Bottle, row: HistoryRow, atMs: number): HistoryEdit {
  const segments = readSegments(bottle.payload).map((s) => ({ ...s }));
  const offset = offsetOf(bottle, atMs);
  const payload: EventPayload = { ...bottle.payload };
  if (row.kind === 'pause') {
    const s = segments[row.index];
    if (!s) return { problem: 'order' };
    if (s.begin !== undefined || row.index === 0) {
      s.begin = s.begin ?? 0;
      s.seconds = offset - s.begin;
    } else {
      s.begin = offset - s.seconds;
    }
    if (isPausedNow(bottle) && row.index === segments.length - 1) {
      setOwn<unknown>(payload, PAUSED_AT_KEY, new Date(atMs).toISOString());
    }
  } else if (row.kind === 'resume' && row.open) {
    const last = segments[segments.length - 1];
    const lastEnd = last ? segmentEnd(last) : null;
    if (!last || lastEnd === null || !allTimed(segments)) return { problem: 'order' };
    if (offset < lastEnd) return { problem: 'order' };
    setOwn<unknown>(payload, PAUSED_SECONDS_KEY, pausesBetween(segments) + (offset - lastEnd));
  } else if (row.kind === 'resume') {
    const s = segments[row.index];
    if (!s) return { problem: 'order' };
    const end = segmentEnd(s);
    if (end !== null) s.seconds = end - offset;
    s.begin = offset;
  } else {
    return { payload };
  }
  return checked(bottle, payload, segments);
}

/**
 * The history with the level at a pause (or at the end) set to `levelMl` (whole ml): the stretch
 * before it ends there and the next one starts there.
 */
export function setRowLevel(bottle: Bottle, row: HistoryRow, levelMl: number): HistoryEdit {
  const segments = readSegments(bottle.payload).map((s) => ({ ...s }));
  const level = Math.max(0, Math.round(levelMl));
  const index = row.kind === 'resume' ? row.index - 1 : row.index;
  const s = segments[index];
  if (!s || row.kind === 'start') return { problem: 'level' };
  s.leftMl = level;
  const next = segments[index + 1];
  if (next) next.startMl = level;
  return checked(bottle, bottle.payload, segments);
}

/** Whether pauses can be added and removed: every stretch has a time (or none was stored yet). */
export function canReshape(bottle: Bottle): boolean {
  const segments = readSegments(bottle.payload);
  if (segments.length > 0) return allTimed(segments);
  const pause = readPause(bottle.payload);
  return pause.count === 0 && pause.pausedSeconds === 0 && pause.pausedAt === null;
}

/**
 * The history with a pause added from `pauseAtMs` to `resumeAtMs`, `levelMl` left (or unknown):
 * the stretch drinking at that moment is split in two. On a running bottle drinking now the open
 * stretch is split: a stretch closes at the pause and the drinking goes on from the resume.
 */
export function addPause(
  bottle: Bottle,
  pauseAtMs: number,
  resumeAtMs: number,
  levelMl: number | null,
): HistoryEdit {
  if (!canReshape(bottle)) return { problem: 'order' };
  const segments = readSegments(bottle.payload).map((s) => ({ ...s }));
  if (segments.length >= MAX_SEGMENTS) return { problem: 'full' };
  const p = offsetOf(bottle, pauseAtMs);
  const r = offsetOf(bottle, resumeAtMs);
  if (r < p) return { problem: 'order' };
  const level = levelMl === null ? null : Math.max(0, Math.round(levelMl));
  const payload: EventPayload = { ...bottle.payload };
  const length = lengthOf(bottle);
  const index = segments.findIndex((s) => (s.begin ?? 0) <= p && r <= (segmentEnd(s) ?? 0));
  if (index >= 0) {
    const s = segments[index];
    const end = segmentEnd(s) ?? 0;
    const before: BottleSegment = { startMl: s.startMl, leftMl: level, seconds: p - (s.begin ?? 0), begin: s.begin ?? 0 };
    const after: BottleSegment = { startMl: level, leftMl: s.leftMl, seconds: end - r, begin: r };
    segments.splice(index, 1, before, after);
    return checked(bottle, payload, segments);
  }
  if (segments.length === 0 && length !== null) {
    if (r > length) return { problem: 'afterEnd' };
    const prepared = preparedLevel(payload);
    segments.push(
      { startMl: prepared, leftMl: level, seconds: p, begin: 0 },
      { startMl: level, leftMl: endLevelFromTotals(payload), seconds: length - r, begin: r },
    );
    return checked(bottle, payload, segments);
  }
  const open = bottle.endedAt === null && !isPausedNow(bottle) ? openBegin(bottle, segments) : null;
  if (open === null || p < open) return { problem: 'order' };
  const startMl = segments.length > 0 ? segments[segments.length - 1].leftMl : preparedLevel(payload);
  segments.push({ startMl, leftMl: level, seconds: p - open, begin: open });
  setOwn<unknown>(payload, PAUSED_SECONDS_KEY, pausesBetween(segments) + (r - p));
  return checked(bottle, payload, segments);
}

/**
 * The history without the pause after stretch `index`: the stretches around it become one (the
 * later level stays). The last pause of a running bottle (open or followed by the drinking now)
 * goes too: the bottle is drinking from where the stretch before it began. The pause of a bottle
 * that ended while paused runs to the end instead.
 */
export function removePause(bottle: Bottle, index: number): HistoryEdit {
  if (!canReshape(bottle)) return { problem: 'order' };
  const segments = readSegments(bottle.payload).map((s) => ({ ...s }));
  const s = segments[index];
  if (!s) return { problem: 'order' };
  let payload: EventPayload = { ...bottle.payload };
  const next = segments[index + 1];
  if (next) {
    const end = segmentEnd(next) ?? 0;
    segments.splice(index, 2, { ...s, leftMl: next.leftMl, seconds: end - (s.begin ?? 0) });
    return checked(bottle, payload, segments);
  }
  const length = lengthOf(bottle);
  if (length !== null) {
    segments[index] = { ...s, seconds: length - (s.begin ?? 0) };
    return checked(bottle, payload, segments);
  }
  // Running: the stretch goes, the drinking now began where it began.
  segments.splice(index, 1);
  payload = withoutOwn<unknown>(payload, PAUSED_AT_KEY);
  const prev = segments[segments.length - 1];
  const lastPause = prev ? (s.begin ?? 0) - (segmentEnd(prev) ?? 0) : 0;
  setOwn<unknown>(payload, PAUSED_SECONDS_KEY, pausesBetween(segments) + lastPause);
  setOwn<unknown>(payload, PAUSE_COUNT_KEY, segments.length);
  return checked(bottle, payload, segments);
}

/**
 * The history moved to new start and end times keeping every pause at its clock time (the sheet's
 * time fields): the first stretch still begins at the start; a last stretch that closed at the old
 * end closes at the new one. Offsets that would fall before the start become 0 (the times check
 * then shows the problem).
 */
export function rebaseHistory(payload: EventPayload, from: Times, to: Times): EventPayload {
  const segments = parseSegments(getOwn(payload, SEGMENTS_KEY));
  if (segments === null || (from.startedAt === to.startedAt && from.endedAt === to.endedAt)) {
    return payload;
  }
  const shift = (Date.parse(from.startedAt) - Date.parse(to.startedAt)) / MS;
  const move = (offset: number) => Math.max(0, Math.floor(offset + shift));
  const oldLength = lengthOf(from);
  const newLength = lengthOf(to);
  const moved = segments.map((s, i) => {
    const end = segmentEnd(s);
    if (s.begin === undefined || end === null) return s;
    const begin = i === 0 ? 0 : move(s.begin);
    const closesAtEnd =
      i === segments.length - 1 && oldLength !== null && newLength !== null && end >= oldLength;
    const newEnd = closesAtEnd ? (newLength ?? 0) : move(end);
    return { ...s, begin, seconds: Math.max(0, newEnd - begin) };
  });
  return withHistory(payload, moved);
}

