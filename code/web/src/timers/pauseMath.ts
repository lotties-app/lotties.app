import type { BabyEvent, EventPayload } from '../db/models';
import { getOwn, setOwn, withoutOwn } from '../util/ownProperty';

/*
 * Timer pauses (docs/design/SYNTHESIS.md section 6, docs/SPEC.md "Timer pauses and sleep details").
 * Three reserved payload keys, valid for any event type: `pause_count`, `paused_seconds` (all
 * finished pauses) and `paused_at` (start of the current pause, present only while paused).
 * Everything is derived from instants, so the arithmetic is DST- and midnight-safe. Pure.
 */

export const PAUSE_COUNT_KEY = 'pause_count';
export const PAUSED_SECONDS_KEY = 'paused_seconds';
export const PAUSED_AT_KEY = 'paused_at';
export const PAUSE_KEYS: readonly string[] = [PAUSE_COUNT_KEY, PAUSED_SECONDS_KEY, PAUSED_AT_KEY];
/**
 * Start of the open nursing segment (see now/nursing.ts). Resuming moves it forward by the pause so
 * the open segment never counts paused time.
 */
export const SEGMENT_START_KEY = 'side_since';

/** API bounds of the keys (the server answers 400 beyond them). */
export const MAX_PAUSE_COUNT = 100;
export const MAX_PAUSED_SECONDS = 86_400;
/** A pause longer than this counts as a forgotten timer too (docs/design/SYNTHESIS.md). */
export const LONG_PAUSE_SECONDS = 2 * 3600;

const MS = 1000;

type Clock = Date | number;
const ms = (value: Clock) => (typeof value === 'number' ? value : value.getTime());

export interface PauseInfo {
  count: number;
  /** Seconds of the finished pauses. */
  pausedSeconds: number;
  /** Start of the open pause (UTC ISO), or `null`. */
  pausedAt: string | null;
}

function wholeNumber(value: unknown, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.min(max, Math.max(0, Math.floor(value)));
}

function validInstant(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

/** The pause keys of a payload, leniently (anything unusable counts as no pause). */
export function readPause(payload: Readonly<EventPayload>): PauseInfo {
  return {
    count: wholeNumber(getOwn(payload, PAUSE_COUNT_KEY), MAX_PAUSE_COUNT),
    pausedSeconds: wholeNumber(getOwn(payload, PAUSED_SECONDS_KEY), MAX_PAUSED_SECONDS),
    pausedAt: validInstant(getOwn(payload, PAUSED_AT_KEY)),
  };
}

type TimerShape = Pick<BabyEvent, 'payload' | 'startedAt' | 'endedAt'>;

/** Whether the timer runs and is paused right now. */
export function isPaused(event: Pick<BabyEvent, 'payload' | 'endedAt'>): boolean {
  return event.endedAt === null && readPause(event.payload).pausedAt !== null;
}

/** Start of the open pause of a running timer (UTC ISO), or `null`. */
export function pausedSince(event: Pick<BabyEvent, 'payload' | 'endedAt'>): string | null {
  return event.endedAt === null ? readPause(event.payload).pausedAt : null;
}

/** Whether any pause was recorded (finished or open). */
export function hasPauses(event: Pick<BabyEvent, 'payload'>): boolean {
  const pause = readPause(event.payload);
  return pause.pausedSeconds > 0 || pause.count > 0 || pause.pausedAt !== null;
}

/** Seconds the open pause has lasted at `now` (0 when not paused). */
export function currentPauseSeconds(event: TimerShape, now: Clock): number {
  const { pausedAt } = readPause(event.payload);
  if (event.endedAt !== null || pausedAt === null) return 0;
  return Math.max(0, Math.floor((ms(now) - Date.parse(pausedAt)) / MS));
}

/** Seconds spent paused so far: finished pauses plus the open one (running timers only). */
export function totalPausedSeconds(event: TimerShape, now: Clock): number {
  return readPause(event.payload).pausedSeconds + currentPauseSeconds(event, now);
}

/** `(end or now) - start` in whole seconds, never negative; pauses not removed. */
export function wallSeconds(event: Pick<BabyEvent, 'startedAt' | 'endedAt'>, now: Clock): number {
  const end = event.endedAt === null ? ms(now) : Date.parse(event.endedAt);
  return Math.max(0, Math.floor((end - Date.parse(event.startedAt)) / MS));
}

/**
 * Seconds the timer has actually run at `now`: (end or now - start) - paused_seconds - (the open
 * pause so far). Never negative. A stopped event ignores a stray `paused_at`.
 */
export function effectiveElapsedSeconds(event: TimerShape, now: Clock = Date.now()): number {
  return Math.max(0, wallSeconds(event, now) - totalPausedSeconds(event, now));
}

/**
 * The effective length of a finished event: (end - start) - paused_seconds. For a running one it is
 * the elapsed so far at `now`.
 */
export function effectiveDurationSeconds(event: TimerShape, now: Clock = Date.now()): number {
  return effectiveElapsedSeconds(event, now);
}

export const effectiveDurationMs = (event: TimerShape, now: Clock = Date.now()) =>
  effectiveDurationSeconds(event, now) * MS;

/**
 * Effective milliseconds inside [from, to] (a calendar day, say): the clipped length minus the
 * pauses, spread evenly over the event (pause positions are not stored). Exact for events inside
 * the window.
 */
export function effectiveMsInWindow(
  event: TimerShape,
  fromMs: number,
  toMs: number,
  now: Clock = Date.now(),
): number {
  const start = Date.parse(event.startedAt);
  const end = event.endedAt === null ? ms(now) : Date.parse(event.endedAt);
  const wall = Math.max(0, end - start);
  const clipped = Math.max(0, Math.min(end, toMs) - Math.max(start, fromMs));
  if (wall === 0 || clipped === 0) return 0;
  const effective = effectiveDurationSeconds(event, now) * MS;
  return Math.round((effective * clipped) / wall);
}

/** The payload with `paused_at` = `at`. Already paused: unchanged. */
export function withPause(payload: Readonly<EventPayload>, at: Clock): EventPayload {
  if (readPause(payload).pausedAt !== null) return { ...payload };
  const next: EventPayload = { ...payload };
  setOwn<unknown>(next, PAUSED_AT_KEY, new Date(ms(at)).toISOString());
  return next;
}

function shiftSegmentStart(payload: EventPayload, byMs: number) {
  const since = Date.parse(String(getOwn(payload, SEGMENT_START_KEY) ?? ''));
  if (Number.isFinite(since) && byMs > 0) {
    setOwn<unknown>(payload, SEGMENT_START_KEY, new Date(since + byMs).toISOString());
  }
}

/**
 * The payload with the open pause folded in at `at`: `paused_seconds` grows by its length,
 * `pause_count` by one, `paused_at` is removed and an open nursing segment moves forward by the
 * pause. Not paused: unchanged.
 */
export function withResume(payload: Readonly<EventPayload>, at: Clock): EventPayload {
  const { pausedAt, pausedSeconds, count } = readPause(payload);
  if (pausedAt === null) return { ...payload };
  const pausedMs = Math.max(0, ms(at) - Date.parse(pausedAt));
  const next = withoutOwn(payload, PAUSED_AT_KEY);
  const seconds = Math.floor(pausedMs / MS);
  setOwn<unknown>(next, PAUSED_SECONDS_KEY, Math.min(MAX_PAUSED_SECONDS, pausedSeconds + seconds));
  setOwn<unknown>(next, PAUSE_COUNT_KEY, Math.min(MAX_PAUSE_COUNT, count + 1));
  shiftSegmentStart(next, pausedMs);
  return next;
}

/**
 * Makes the pause keys valid for an event with these times, like the API requires once an event
 * ended: whole numbers within bounds, no `paused_at` (the open pause is folded in at the end) and
 * `paused_seconds` at most the length. A payload without pause keys is returned as is.
 */
export function normalizePause(
  payload: Readonly<EventPayload>,
  startedAt: string,
  endedAt: string | null,
): EventPayload {
  if (!PAUSE_KEYS.some((key) => Object.hasOwn(payload, key))) return payload;
  let next: EventPayload = { ...payload };
  if (endedAt !== null) next = withResume(next, Date.parse(endedAt));
  const pause = readPause(next);
  const cap =
    endedAt === null
      ? MAX_PAUSED_SECONDS
      : Math.min(
          MAX_PAUSED_SECONDS,
          Math.max(0, Math.floor((Date.parse(endedAt) - Date.parse(startedAt)) / MS)),
        );
  const seconds = Math.min(cap, pause.pausedSeconds);
  if (Object.hasOwn(next, PAUSED_SECONDS_KEY) || seconds > 0) {
    setOwn<unknown>(next, PAUSED_SECONDS_KEY, seconds);
  }
  if (Object.hasOwn(next, PAUSE_COUNT_KEY) || pause.count > 0) {
    setOwn<unknown>(next, PAUSE_COUNT_KEY, pause.count);
  }
  if (pause.pausedAt === null && Object.hasOwn(next, PAUSED_AT_KEY)) {
    next = withoutOwn(next, PAUSED_AT_KEY);
  }
  return next;
}

export interface PauseProblem {
  field: typeof PAUSE_COUNT_KEY | typeof PAUSED_SECONDS_KEY | typeof PAUSED_AT_KEY;
  code: 'number' | 'min' | 'max' | 'instant' | 'ended';
}

function numberProblem(raw: unknown, max: number): PauseProblem['code'] | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'number' || !Number.isInteger(raw)) return 'number';
  if (raw < 0) return 'min';
  return raw > max ? 'max' : null;
}

/** Client mirror of the API's pause key rules (400 `validation_failed`), in field order. */
export function pauseProblems(
  payload: Readonly<EventPayload>,
  startedAt: string,
  endedAt: string | null,
): PauseProblem[] {
  const problems: PauseProblem[] = [];
  const count = numberProblem(getOwn(payload, PAUSE_COUNT_KEY), MAX_PAUSE_COUNT);
  if (count) problems.push({ field: PAUSE_COUNT_KEY, code: count });
  const seconds = getOwn(payload, PAUSED_SECONDS_KEY);
  const secondsProblem = numberProblem(seconds, MAX_PAUSED_SECONDS);
  if (secondsProblem) problems.push({ field: PAUSED_SECONDS_KEY, code: secondsProblem });
  else if (
    endedAt !== null &&
    typeof seconds === 'number' &&
    seconds > (Date.parse(endedAt) - Date.parse(startedAt)) / MS
  ) {
    problems.push({ field: PAUSED_SECONDS_KEY, code: 'max' });
  }
  const at = getOwn(payload, PAUSED_AT_KEY);
  if (at !== undefined && at !== null) {
    if (validInstant(at) === null) problems.push({ field: PAUSED_AT_KEY, code: 'instant' });
    else if (endedAt !== null) problems.push({ field: PAUSED_AT_KEY, code: 'ended' });
  }
  return problems;
}
