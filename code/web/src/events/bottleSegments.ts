import type { EventPayload, EventType } from '../db/models';
import { readPause } from '../timers/pauseMath';
import { getOwn, setOwn, withoutOwn } from '../util/ownProperty';
import { DRUNK_KEY, ENDED_BY_KEY, ENDED_BY_SLEEP, PREPARED_KEY, preparedMl } from './bottleAmounts';

/*
 * The drinking stretches of a timed bottle (docs/design/20-feeding-amounts.md section 5), in the
 * hidden built-in feeding field `segments`: compact text `start>left@seconds` per stretch, joined
 * by `;` ("120>70@300;70>0@240"). A stretch runs from the start or a resume to the next pause or
 * the stop; `start` is the level in the bottle when it began (the prepared amount for the first),
 * `left` the level when it ended, either `?` when unknown (the parent skipped the question), and
 * `seconds` its drinking time (pauses excluded). Since the bottle history
 * (docs/design/44-bottle-history.md) a stretch may end in `+begin`: when it began, whole seconds
 * from the feeding's start ("120>80@360+0;80>15@780+540"); the pause after a stretch lasts until
 * the next one begins. Same grammar and rules as the API's `BottleSegments`/`BottleHistory`; both
 * read `bottleSegmentsVectors.json`. The total `amount_drunk_ml` stays the single source of every
 * total. Pure.
 */

export const SEGMENTS_KEY = 'segments';
export const MAX_SEGMENTS = 20;
export const MAX_SEGMENTS_LENGTH = 480;
export const MAX_LEVEL_ML = 2000;
export const MAX_SEGMENT_SECONDS = 86_400;

export interface BottleSegment {
  /** Level when the stretch began (ml), `null` when unknown. */
  startMl: number | null;
  /** Level when it ended (ml), `null` when unknown. */
  leftMl: number | null;
  /** Drinking time of the stretch (pauses excluded). */
  seconds: number;
  /** When it began, whole seconds from the feeding's start; absent: time unknown (older bottles). */
  begin?: number;
}

/** When a stretch ended (seconds from the feeding's start), when its begin is known. */
export const segmentEnd = (segment: BottleSegment): number | null =>
  segment.begin === undefined ? null : segment.begin + segment.seconds;

const SEGMENT =
  /^(\?|0|[1-9][0-9]{0,3})>(\?|0|[1-9][0-9]{0,3})@(0|[1-9][0-9]{0,4})(?:\+(0|[1-9][0-9]{0,4}))?$/;

function level(text: string): number | null | undefined {
  if (text === '?') return null;
  const value = Number(text);
  return value <= MAX_LEVEL_ML ? value : undefined;
}

/** The stretches of `text`, or `null` when it breaks the grammar or the bounds. */
export function parseSegments(text: unknown): BottleSegment[] | null {
  if (typeof text !== 'string' || text === '' || text.length > MAX_SEGMENTS_LENGTH) return null;
  const parts = text.split(';');
  if (parts.length > MAX_SEGMENTS) return null;
  const segments: BottleSegment[] = [];
  for (const part of parts) {
    const match = SEGMENT.exec(part);
    if (!match) return null;
    const startMl = level(match[1]);
    const leftMl = level(match[2]);
    const seconds = Number(match[3]);
    const begin = match[4] === undefined ? undefined : Number(match[4]);
    if (startMl === undefined || leftMl === undefined || seconds > MAX_SEGMENT_SECONDS) return null;
    if (begin !== undefined && begin > MAX_SEGMENT_SECONDS) return null;
    segments.push(begin === undefined ? { startMl, leftMl, seconds } : { startMl, leftMl, seconds, begin });
  }
  return segments;
}

const levelText = (value: number | null) => (value === null ? '?' : String(value));

/** The text form of `segments` (the caller keeps them within the bounds). */
export function formatSegments(segments: readonly BottleSegment[]): string {
  return segments
    .map(
      (s) =>
        `${levelText(s.startMl)}>${levelText(s.leftMl)}@${s.seconds}` +
        (s.begin === undefined ? '' : `+${s.begin}`),
    )
    .join(';');
}

export type HistoryTimeProblem = 'firstBegin' | 'order' | 'afterEnd';

/**
 * Why the times of `segments` break the rules (API `BottleHistory.TimeProblem`), or `null`: a
 * timed first stretch begins at 0; a timed stretch begins at or after the end of the timed one
 * before it (in order, pauses never overlap); once ended (`lengthSeconds`: whole seconds from
 * start to end) no timed stretch ends after the end. Stretches without a time are skipped.
 */
export function historyTimeProblem(
  segments: readonly BottleSegment[],
  lengthSeconds: number | null,
): HistoryTimeProblem | null {
  const first = segments[0]?.begin;
  if (first !== undefined && first !== 0) return 'firstBegin';
  let previousEnd: number | null = null;
  for (const segment of segments) {
    const end = segmentEnd(segment);
    if (segment.begin === undefined || end === null) continue;
    if (previousEnd !== null && segment.begin < previousEnd) return 'order';
    if (lengthSeconds !== null && end > lengthSeconds) return 'afterEnd';
    previousEnd = end;
  }
  return null;
}

/** What the baby drank in a stretch (ml), when both levels are known. */
export function segmentDrunkMl(segment: BottleSegment): number | null {
  return segment.startMl !== null && segment.leftMl !== null
    ? segment.startMl - segment.leftMl
    : null;
}

/** The stretches stored on the payload (`[]` when absent or malformed). */
export function readSegments(payload: Readonly<EventPayload>): BottleSegment[] {
  return parseSegments(getOwn(payload, SEGMENTS_KEY)) ?? [];
}

const finite = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;

/** The known levels in time order: the first start, then every end. */
function knownLevels(segments: readonly BottleSegment[]): number[] {
  return [segments[0]?.startMl ?? null, ...segments.map((s) => s.leftMl)].filter(
    (value): value is number => value !== null,
  );
}

/**
 * Whether the payload's `segments` breaks the API's rules (`BottleSegments.EnsureValid`): malformed;
 * a stretch ends above its start; a stretch does not start where the previous one ended (both known
 * and equal, or both unknown); a known level above `amount_ml`; the levels say more was drunk than
 * the total (`amount_drunk_ml`, absent = all); or, once `ended`, the last known end level disagrees
 * with the total; or the times break `historyTimeProblem` (`lengthSeconds`: the ended feeding's
 * whole seconds, `null`/absent: not checked against the end). Absent, `null` or not text: no
 * problem here.
 */
export function segmentsProblem(
  payload: Readonly<EventPayload>,
  ended: boolean,
  lengthSeconds: number | null = null,
): boolean {
  const raw = getOwn(payload, SEGMENTS_KEY);
  if (typeof raw !== 'string') return false;
  const segments = parseSegments(raw);
  if (segments === null) return true;
  for (let i = 0; i < segments.length; i += 1) {
    const drunk = segmentDrunkMl(segments[i]);
    if (drunk !== null && drunk < 0) return true;
    if (i > 0 && segments[i].startMl !== segments[i - 1].leftMl) return true;
  }
  if (historyTimeProblem(segments, ended ? lengthSeconds : null) !== null) return true;
  const prepared = finite(getOwn(payload, PREPARED_KEY));
  if (prepared === null) return false;
  const levels = knownLevels(segments);
  if (levels.some((value) => value > prepared)) return true;
  const drunk = finite(getOwn(payload, DRUNK_KEY));
  const total = drunk === null ? prepared : Math.min(drunk, prepared);
  const lastKnown = levels[levels.length - 1];
  if (lastKnown !== undefined && prepared - lastKnown > total) return true;
  const left = segments[segments.length - 1].leftMl;
  return ended && left !== null && prepared - left !== total;
}

/** A bottle of the built-in feeding type (the only payload that may hold `segments`). */
export function isBuiltInBottle(
  type: Pick<EventType, 'key' | 'babyId'> | undefined,
  payload: Readonly<EventPayload>,
): boolean {
  return type?.babyId === null && type.key === 'feeding' && getOwn(payload, 'method') === 'bottle';
}

/** The level the first stretch starts at: the prepared amount, in whole ml (`null`: unknown). */
function firstLevel(payload: Readonly<EventPayload>): number | null {
  const prepared = preparedMl(payload);
  return prepared === undefined || prepared > MAX_LEVEL_ML ? null : Math.floor(prepared);
}

/** A reported level that fits after `start` and within the prepared amount, else `null`. */
function fittingLevel(
  payload: Readonly<EventPayload>,
  start: number | null,
  left: number | null,
): number | null {
  if (left === null || !Number.isFinite(left) || left < 0) return null;
  const whole = Math.floor(left);
  const prepared = preparedMl(payload);
  if (whole > MAX_LEVEL_ML || (prepared !== undefined && whole > prepared)) return null;
  return start !== null && whole > start ? null : whole;
}

const withSegments = (payload: Readonly<EventPayload>, segments: readonly BottleSegment[]) => {
  const next: EventPayload = { ...payload };
  setOwn<unknown>(next, SEGMENTS_KEY, formatSegments(segments));
  return next;
};

const drinkingSum = (segments: readonly BottleSegment[]) =>
  segments.reduce((sum, s) => sum + s.seconds, 0);

/**
 * The payload with the open stretch closed: it began at the previous stretch's end level (the
 * prepared amount for the first) and lasted `drinkingSeconds` (all drinking so far) minus the
 * earlier stretches; `leftMl` is the level now (`null`: unknown). At the cap of stretches the last
 * one is extended instead (its time dropped: the pause inside it is no longer in the history).
 * The new stretch carries its begin (design 44) when every earlier one does: the drinking and the
 * finished pauses (`paused_seconds`) before it. Used at a pause (level unknown until the parent
 * answers) and at the stop.
 */
export function closeSegment(
  payload: Readonly<EventPayload>,
  drinkingSeconds: number,
  leftMl: number | null,
): EventPayload {
  const segments = readSegments(payload);
  const seconds = Math.min(
    MAX_SEGMENT_SECONDS,
    Math.max(0, Math.floor(drinkingSeconds) - drinkingSum(segments)),
  );
  const last = segments[segments.length - 1];
  if (last && segments.length >= MAX_SEGMENTS) {
    const merged: BottleSegment = {
      startMl: last.startMl,
      leftMl: fittingLevel(payload, last.startMl, leftMl),
      seconds: Math.min(MAX_SEGMENT_SECONDS, last.seconds + seconds),
    };
    return withSegments(payload, [...segments.slice(0, -1), merged]);
  }
  const startMl = last ? last.leftMl : firstLevel(payload);
  const begin = segments.every((s) => s.begin !== undefined)
    ? drinkingSum(segments) + readPause(payload).pausedSeconds
    : undefined;
  const closed: BottleSegment = { startMl, leftMl: fittingLevel(payload, startMl, leftMl), seconds };
  if (begin !== undefined && begin <= MAX_SEGMENT_SECONDS) closed.begin = begin;
  return withSegments(payload, [...segments, closed]);
}

/**
 * The payload with the last stretch's end level set to `leftMl` (the answer to "How much is left
 * in the bottle?"), when it fits (never above its start or the prepared amount). `expectedCount`:
 * only while the stretches are still that many (an answer that arrives after the next pause
 * changes nothing).
 */
export function withLastLevel(
  payload: Readonly<EventPayload>,
  leftMl: number,
  expectedCount?: number,
): EventPayload {
  const segments = readSegments(payload);
  const last = segments[segments.length - 1];
  if (!last || (expectedCount !== undefined && segments.length !== expectedCount)) return payload;
  const fitted = fittingLevel(payload, last.startMl, leftMl);
  if (fitted === null) return payload;
  return withSegments(payload, [...segments.slice(0, -1), { ...last, leftMl: fitted }]);
}

/**
 * The level left at the stop, as the totals say: prepared minus drunk (absent drunk = all, so 0);
 * `null` when the prepared amount is unknown or a sleep stopped the bottle without a drunk amount
 * (nobody was asked).
 */
function finalLevel(payload: Readonly<EventPayload>): number | null {
  const prepared = finite(getOwn(payload, PREPARED_KEY));
  if (prepared === null) return null;
  const drunk = finite(getOwn(payload, DRUNK_KEY));
  if (drunk === null && getOwn(payload, ENDED_BY_KEY) === ENDED_BY_SLEEP) return null;
  return Math.max(0, prepared - (drunk === null ? prepared : Math.min(drunk, prepared)));
}

/**
 * The payload of a bottle that just stopped, with its last stretch closed: the drinking time since
 * the previous stretch (`drinkingSeconds` = the bottle's effective length) and the level the totals
 * give. Stopped while paused (`wasPaused`, or no drinking since): the last stretch takes that
 * level instead, and the history keeps the last pause running to the end. A bottle without
 * stretches (never paused) is returned as is.
 */
export function closeAtStop(
  payload: Readonly<EventPayload>,
  drinkingSeconds: number,
  wasPaused = false,
) {
  const segments = readSegments(payload);
  if (segments.length === 0) return payload;
  const left = finalLevel(payload);
  if (!wasPaused && Math.floor(drinkingSeconds) - drinkingSum(segments) >= 1) {
    return closeSegment(payload, drinkingSeconds, left);
  }
  return left === null ? payload : withLastLevel(payload, left);
}

/**
 * `payload` (a bottle) with `segments` the API accepts for the totals: unchanged when they
 * already fit; else the last end level made to match the totals, else forgotten (`?`), else the
 * field dropped. Anything but a bottle, or text that is not this grammar (never written by the
 * app), is left alone.
 */
export function settleSegments(payload: EventPayload, ended: boolean): EventPayload {
  if (getOwn(payload, 'method') !== 'bottle' || !segmentsProblem(payload, ended)) return payload;
  const segments = parseSegments(getOwn(payload, SEGMENTS_KEY));
  // Times are checked by the sheet's history (`bottleHistory.ts`), never silently dropped here.
  if (segments === null || historyTimeProblem(segments, null) !== null) return payload;
  const last = segments[segments.length - 1];
  const candidates: (number | null)[] = [];
  const total = ended ? finalLevel(payload) : null;
  if (total !== null) candidates.push(total);
  candidates.push(null);
  for (const leftMl of candidates) {
    const fitted = leftMl === null ? null : fittingLevel(payload, last.startMl, leftMl);
    if (leftMl !== null && fitted === null) continue;
    const next = withSegments(payload, [...segments.slice(0, -1), { ...last, leftMl: fitted }]);
    if (!segmentsProblem(next, ended)) return next;
  }
  return withoutOwn<unknown>(payload, SEGMENTS_KEY);
}

export type LevelShare = 'full' | 'threeQuarters' | 'half' | 'quarter' | 'empty';

export interface LevelChoice {
  ml: number;
  share: LevelShare;
}

const LEVEL_SHARES: readonly { share: LevelShare; factor: number }[] = [
  { share: 'full', factor: 1 },
  { share: 'threeQuarters', factor: 0.75 },
  { share: 'half', factor: 0.5 },
  { share: 'quarter', factor: 0.25 },
  { share: 'empty', factor: 0 },
];

/** Rounding step of the level quick choices (ml). */
const LEVEL_STEP_ML = 5;

/**
 * The quick choices for what is left in the bottle: full, 3/4, half, 1/4 and empty of the prepared
 * amount, in whole ml rounded to 5 (full is the prepared amount, floored), each amount once (the
 * larger share keeps it), descending; choices above `ceilingMl` (the level the open stretch started
 * at, when known) are left out. Empty without a prepared amount.
 */
export function levelChoices(
  preparedMl: number | null | undefined,
  ceilingMl: number | null = null,
): LevelChoice[] {
  if (preparedMl == null || !Number.isFinite(preparedMl) || preparedMl <= 0) return [];
  const top = Math.floor(Math.min(preparedMl, MAX_LEVEL_ML));
  const choices: LevelChoice[] = [];
  for (const { share, factor } of LEVEL_SHARES) {
    const ml =
      share === 'full'
        ? top
        : Math.min(top, Math.round((top * factor) / LEVEL_STEP_ML) * LEVEL_STEP_ML);
    if (ceilingMl !== null && ml > ceilingMl) continue;
    if (!choices.some((c) => c.ml === ml)) choices.push({ ml, share });
  }
  return choices;
}

/** The level the open stretch started at (the last end level, else the prepared amount). */
export function currentStartLevel(payload: Readonly<EventPayload>): number | null {
  const segments = readSegments(payload);
  return segments.length === 0 ? firstLevel(payload) : segments[segments.length - 1].leftMl;
}
