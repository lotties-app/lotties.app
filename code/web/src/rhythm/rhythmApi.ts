import type { ApiClient } from '../api/apiClient';
import { ApiError } from '../api/ApiError';
import { API_PREFIX } from '../sync/contract';

/*
 * Her rhythm (docs/design/48-baby-rhythm.md section 6): `GET /babies/{id}/rhythm`, computed by the
 * server from the baby's own log on every request. Numbers and statuses only, no prose. The answer
 * lives in the react-query memory cache and nowhere else (never Dexie, localStorage or the outbox).
 * The parser is defensive: an unknown status becomes `unknown` and a value is kept only when its
 * status is `ok` and the number is really there, so nothing is ever shown that the rule did not pass.
 */

/** `unknown`: a status this client does not know (a newer server); shown as not available. */
export type MetricStatus = 'ok' | 'not_enough_data' | 'unknown';
export type ClockStatus = MetricStatus | 'varies';
export type OutcomeStatus = MetricStatus | 'no_clear_difference';

export interface ClockMetric {
  status: ClockStatus;
  /** Local `HH:mm`; only with `ok`. */
  usual: string | null;
  /** Circular spread in minutes; with `ok` and `varies`. */
  spreadMinutes: number | null;
  nights: number;
}

export interface MinutesRange {
  status: MetricStatus;
  count: number;
  /** p25, median and p75 in whole minutes; only with `ok`. */
  range: { p25: number; median: number; p75: number } | null;
}

export interface CountRange {
  status: MetricStatus;
  count: number;
  range: { p25: number; median: number; p75: number } | null;
}

export interface UsualStart {
  usual: string;
  windowStart: string;
  windowEnd: string;
  days: number;
}

export type RhythmFactor = 'evening_feeds' | 'dirty_diaper_day';
export type RhythmOutcomeKind = 'night_length' | 'longest_stretch' | 'first_stretch';

export interface RhythmOutcome {
  outcome: RhythmOutcomeKind;
  status: OutcomeStatus;
  nightsWith: number;
  nightsWithout: number;
  /** Only with `ok`. */
  differenceMinutes: number | null;
}

export interface RhythmAssociation {
  factor: RhythmFactor;
  threshold: number | null;
  outcomes: RhythmOutcome[];
}

export interface RhythmRule {
  lookBackDays: number;
  eveningDayStartsAt: string;
  minimumNights: number;
  minimumDays: number;
  minimumFeedGaps: number;
  maximumClockSpreadMinutes: number;
  minimumNightMinutes: number;
  maximumNightMinutes: number;
  maximumFeedGapMinutes: number;
  eveningFeedWindowMinutes: number;
  minimumGroupNights: number;
  minimumDifferenceMinutes: number;
}

export interface Rhythm {
  firstDay: string | null;
  lastDay: string | null;
  nights: number;
  bedTime: ClockMetric;
  wakeUp: ClockMetric;
  nightLength: MinutesRange;
  longestStretch: MinutesRange;
  firstStretch: MinutesRange;
  naps: CountRange & { usualStarts: UsualStart[] };
  feeds: CountRange & { gap: MinutesRange };
  associations: RhythmAssociation[];
  rule: RhythmRule;
}

/** The rule values of the design (section 6), used when the answer leaves one out. */
export const DEFAULT_RHYTHM_RULE: RhythmRule = {
  lookBackDays: 28,
  eveningDayStartsAt: '04:00',
  minimumNights: 5,
  minimumDays: 5,
  minimumFeedGaps: 10,
  maximumClockSpreadMinutes: 90,
  minimumNightMinutes: 180,
  maximumNightMinutes: 960,
  maximumFeedGapMinutes: 480,
  eveningFeedWindowMinutes: 240,
  minimumGroupNights: 7,
  minimumDifferenceMinutes: 20,
};

const FACTORS: readonly RhythmFactor[] = ['evening_feeds', 'dirty_diaper_day'];
const OUTCOMES: readonly RhythmOutcomeKind[] = ['night_length', 'longest_stretch', 'first_stretch'];
const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);
const countOf = (value: unknown) => (isFiniteNumber(value) && value >= 0 ? value : 0);
const numberOrNull = (value: unknown) => (isFiniteNumber(value) ? value : null);
const isClock = (value: unknown): value is string => typeof value === 'string' && CLOCK.test(value);

function statusOf<T extends string>(value: unknown, known: readonly T[]): T | 'unknown' {
  return known.find((s) => s === value) ?? 'unknown';
}

function parseClock(value: unknown): ClockMetric {
  const body = isRecord(value) ? value : {};
  let status = statusOf(body.status, ['ok', 'not_enough_data', 'varies'] as const);
  if (status === 'ok' && !isClock(body.usual)) status = 'unknown';
  return {
    status,
    usual: status === 'ok' ? (body.usual as string) : null,
    spreadMinutes: status === 'ok' || status === 'varies' ? numberOrNull(body.spreadMinutes) : null,
    nights: countOf(body.nights),
  };
}

function parseRange(
  body: Record<string, unknown>,
  keys: readonly [string, string, string],
): { status: MetricStatus; range: { p25: number; median: number; p75: number } | null } {
  const status = statusOf(body.status, ['ok', 'not_enough_data'] as const);
  const [p25, median, p75] = keys.map((k) => body[k]);
  if (status !== 'ok') return { status, range: null };
  if (!isFiniteNumber(p25) || !isFiniteNumber(median) || !isFiniteNumber(p75)) {
    return { status: 'unknown', range: null };
  }
  return { status, range: { p25, median, p75 } };
}

function parseMinutes(value: unknown): MinutesRange {
  const body = isRecord(value) ? value : {};
  return {
    ...parseRange(body, ['p25Minutes', 'medianMinutes', 'p75Minutes']),
    count: countOf(body.count),
  };
}

function parseCounts(body: Record<string, unknown>): CountRange {
  return { ...parseRange(body, ['p25', 'median', 'p75']), count: countOf(body.count) };
}

function parseUsualStart(value: unknown): UsualStart | null {
  if (!isRecord(value) || !isClock(value.usual)) return null;
  return {
    usual: value.usual,
    windowStart: isClock(value.windowStart) ? value.windowStart : value.usual,
    windowEnd: isClock(value.windowEnd) ? value.windowEnd : value.usual,
    days: countOf(value.days),
  };
}

function parseOutcome(value: unknown): RhythmOutcome | null {
  if (!isRecord(value)) return null;
  const outcome = OUTCOMES.find((o) => o === value.outcome);
  if (!outcome) return null;
  let status = statusOf(value.status, ['ok', 'not_enough_data', 'no_clear_difference'] as const);
  const difference = numberOrNull(value.differenceMinutes);
  if (status === 'ok' && (difference === null || difference === 0)) status = 'unknown';
  return {
    outcome,
    status,
    nightsWith: countOf(value.nightsWith),
    nightsWithout: countOf(value.nightsWithout),
    differenceMinutes: status === 'ok' ? difference : null,
  };
}

function parseAssociation(value: unknown): RhythmAssociation | null {
  if (!isRecord(value)) return null;
  const factor = FACTORS.find((f) => f === value.factor);
  if (!factor) return null;
  const threshold =
    isFiniteNumber(value.threshold) && value.threshold >= 1 ? value.threshold : null;
  const outcomes = Array.isArray(value.outcomes)
    ? value.outcomes.map(parseOutcome).filter((o): o is RhythmOutcome => o !== null)
    : [];
  // An evening-feeds sentence needs its split point: without it nothing of the factor is shown.
  const usable =
    factor === 'evening_feeds' && threshold === null
      ? outcomes.map((o) =>
          o.status === 'ok' ? { ...o, status: 'unknown' as const, differenceMinutes: null } : o,
        )
      : outcomes;
  return { factor, threshold, outcomes: usable };
}

function parseRule(value: unknown): RhythmRule {
  const body = isRecord(value) ? value : {};
  const rule = { ...DEFAULT_RHYTHM_RULE };
  for (const key of Object.keys(rule) as (keyof RhythmRule)[]) {
    const given = body[key];
    if (key === 'eveningDayStartsAt') {
      if (isClock(given)) rule.eveningDayStartsAt = given;
    } else if (isFiniteNumber(given) && given >= 0) {
      rule[key] = given;
    }
  }
  return rule;
}

/** The rhythm, or `null` when the answer is not shaped like it (an older server). */
export function parseRhythm(body: unknown): Rhythm | null {
  if (!isRecord(body) || !isRecord(body.bedTime) || !isRecord(body.nightLength)) return null;
  const naps = isRecord(body.naps) ? body.naps : {};
  const feeds = isRecord(body.feeds) ? body.feeds : {};
  return {
    firstDay: typeof body.firstDay === 'string' ? body.firstDay : null,
    lastDay: typeof body.lastDay === 'string' ? body.lastDay : null,
    nights: countOf(body.nights),
    bedTime: parseClock(body.bedTime),
    wakeUp: parseClock(body.wakeUp),
    nightLength: parseMinutes(body.nightLength),
    longestStretch: parseMinutes(body.longestStretch),
    firstStretch: parseMinutes(body.firstStretch),
    naps: {
      ...parseCounts(naps),
      usualStarts: Array.isArray(naps.usualStarts)
        ? naps.usualStarts.map(parseUsualStart).filter((s): s is UsualStart => s !== null)
        : [],
    },
    feeds: { ...parseCounts(feeds), gap: parseMinutes(feeds.gap) },
    associations: Array.isArray(body.associations)
      ? body.associations.map(parseAssociation).filter((a): a is RhythmAssociation => a !== null)
      : [],
    rule: parseRule(body.rule),
  };
}

export const rhythmPath = (babyId: string, utcOffsetMinutes: number, timeZone?: string) =>
  `${API_PREFIX}/babies/${encodeURIComponent(babyId)}/rhythm?utcOffsetMinutes=${utcOffsetMinutes}` +
  (timeZone ? `&timeZone=${encodeURIComponent(timeZone)}` : '');

/**
 * The baby's rhythm; `null` hides the section: the route is unknown (older server), the baby is
 * gone, or the caller may not read it (403, e.g. a Doctor without the daily-log scope).
 */
export async function getRhythm(
  api: ApiClient,
  babyId: string,
  utcOffsetMinutes: number,
  timeZone: string | undefined,
  signal?: AbortSignal,
): Promise<Rhythm | null> {
  try {
    return parseRhythm(
      await api.request<unknown>(rhythmPath(babyId, utcOffsetMinutes, timeZone), { signal }),
    );
  } catch (error) {
    if (error instanceof ApiError && (error.status === 404 || error.status === 403)) return null;
    throw error;
  }
}
