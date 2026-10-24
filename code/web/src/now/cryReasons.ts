import {
  AGE_NORM_METRICS,
  ageInDaysAt,
  priorFor,
  type AgeNormPopulation,
  type AgeNormSet,
} from '../ageNorms/ageNorms';
import type { BabyEvent, EventType } from '../db/models';
import { ageInMonths } from '../events/bottleAgeDefaults';
import { countsAsCrying } from '../events/cryDetection';
import { adjustedFeedGap, topUpAdjustment } from '../events/bottlePatterns';
import type { PredictionsDto } from '../sync/contract';
import { getOwn } from '../util/ownProperty';
import { bellyPainPattern, windowAround, BELLY_MASSAGE_KEY } from './bellyPattern';
import {
  DIAPER_KEY,
  FEEDING_KEY,
  diaperPredictionsOf,
  dirtySuggestion,
  latestFeedEnd,
} from './diaperPredictions';
import {
  DAY_MS,
  HOUR_MS,
  MINUTE_MS,
  minutesBetween,
  pastLiveEvents,
  payloadString,
  payloadValue,
  typeIdsForKey,
} from './eventFacts';
import { FUSSY_KEY, fussyPattern } from './fussyPattern';
import { deriveNowState } from './nowState';
import { nightWakingSince, overtiredSuggestion, wakeWindowOf } from './overtired';

/*
 * "Why is she crying?" (docs/design/27-cry-reasons.md): ranks what the log suggests and nothing
 * else. It reads the baby's own events (time since the last feed, awake time, time since the last
 * diaper, a feed moments ago) and the cached server numbers (wake window, diaper gaps, belly and
 * fussy time-of-day patterns) and orders a fixed list of everyday causes. It never diagnoses,
 * never names an illness and never suggests a dose or a treatment. Pure, offline and
 * language-free: the sheet renders the structured facts with i18n.
 */

/** The causes, in their stable tie order. `comfort` is the always-present fallback. */
export const CRY_CAUSES = ['hunger', 'sleepy', 'diaper', 'gas', 'comfort'] as const;
export type CryCause = (typeof CRY_CAUSES)[number];
export type CryLevel = 'likely' | 'possible' | 'unlikely';

/** When to call someone instead of looking at the log; always returned, the same list each time. */
export const CRY_RED_FLAGS = [
  'fever',
  'inconsolable',
  'refusingFeeds',
  'unusualSleepiness',
  'bulgingOrStiffFontanelle',
] as const;
export type RedFlagKey = (typeof CRY_RED_FLAGS)[number];

/** Newborn under 6 weeks, 6 weeks to 3 months, 3 to 6 months, 6 months and over. */
export type CryAgeBand = 'newborn' | 'weeks6to3m' | 'months3to6' | 'months6plus';
/** Used without a (valid) birth date. */
export const DEFAULT_CRY_AGE_BAND: CryAgeBand = 'weeks6to3m';

/** One structured reason behind a cause; the UI writes the sentence. Minutes are whole minutes. */
export type CryFact =
  /**
   * Since the start of the latest feed; `usualGapMinutes` is her own usual gap, `null` without one.
   * `smallerFeed`: that feed was a bottle she drank well under her usual amount of (an interrupted
   * or partly drunk bottle), so the gap the ramp uses is shortened (`topUpAdjustment`).
   */
  | { kind: 'sinceLastFeed'; minutes: number; usualGapMinutes: number | null; smallerFeed?: true }
  /** A feeding timer runs (started `minutes` ago). */
  | { kind: 'feedingNow'; minutes: number }
  /** Current awake stretch; `windowMinutes` is her usual limit (server wake window) or `null`. */
  | { kind: 'awakeFor'; minutes: number; windowMinutes: number | null }
  /** It is night time (or she is up in the night). */
  | { kind: 'nightTime' }
  /** Since the latest diaper of any content; `usualGapMinutes` is her usual wet gap or `null`. */
  | { kind: 'sinceLastDiaper'; minutes: number; usualGapMinutes: number | null }
  /** The server's dirty-diaper estimate is due now (UTC ISO of the expected time). */
  | { kind: 'dirtyDue'; signal: 'afterFeed' | 'gap'; expectedAt: string }
  /** A milk feed ended `minutesSinceFeed` ago and no burp or belly massage was logged since it. */
  | { kind: 'recentFeedNoBurp'; minutesSinceFeed: number }
  /** A milk feed ended moments ago and a burp or belly massage was logged with it. */
  | { kind: 'reliefAfterFeed'; minutesSinceFeed: number }
  /** Now is inside her usual belly pain window (`typicalClock` local `HH:mm` of the server). */
  | { kind: 'bellyPattern'; typicalClock: string }
  /** Now is inside her usual fussy window (`typicalClock`), or a generic evening (`null`). */
  | { kind: 'eveningFussy'; typicalClock: string | null }
  /** Nothing to go on: no log for this cause, or a sleep timer runs. */
  | { kind: 'noData'; reason: 'noLog' | 'asleep' };

export interface CryCauseRank {
  cause: CryCause;
  level: CryLevel;
  /** 0..1, rounded to 3 decimals. Only for ordering; never shown as a probability. */
  score: number;
  facts: CryFact[];
}

export interface CryReasonResult {
  /** Score descending; ties keep the order of `CRY_CAUSES`. Always all five causes. */
  causes: CryCauseRank[];
  redFlags: RedFlagKey[];
  /** `generic`: the weights below; `personal` is reserved for a per-baby learner (phase 2). */
  basis: 'generic' | 'personal';
}

export interface CryRamp {
  /** Score with no signal. */
  floor: number;
  /** Score at and past `rampTo`. */
  max: number;
  /** The ratio (elapsed / usual) where the score starts rising... */
  rampFrom: number;
  /** ...and where it reaches `max`. */
  rampTo: number;
}

export interface CryBandWeights {
  /** Defaults when she has no usual value of her own. */
  feedGapMinutes: number;
  wakeWindowMinutes: number;
  diaperGapMinutes: number;
  hunger: CryRamp;
  sleepy: CryRamp & { overtiredBoost: number; nightFloor: number };
  diaper: CryRamp & { dirtyDueBoost: number; staleFloor: number };
  gas: {
    base: number;
    postFeed: number;
    postFeedRelieved: number;
    bellyPattern: number;
    eveningPattern: number;
    /** Generic evening bump without a fussy pattern (0 turns it off for the band). */
    eveningGeneric: number;
    max: number;
  };
  /** The fallback's fixed score; kept under `likelyFrom` and `noDataScore`. */
  comfort: number;
}

export interface CryWeights {
  likelyFrom: number;
  possibleFrom: number;
  /** Score of a cause with nothing logged for it (a neutral `possible`). */
  noDataScore: number;
  /** A feed ended this recently: hunger is capped at `freshCap`. */
  freshFeedMinutes: number;
  /** A diaper was logged this recently: diaper is capped at `freshCap`. */
  freshDiaperMinutes: number;
  freshCap: number;
  /** Score of hunger while a feeding timer runs. */
  runningFeedScore: number;
  /** Gas rises this long after a milk feed ended. */
  postFeedMinutes: number;
  /** No diaper for this long: diaper gets at least `staleFloor`. */
  staleDiaperHours: number;
  /** Generic evening (local hours, end exclusive). */
  eveningFromHour: number;
  eveningUntilHour: number;
  /** Her own feed gap: feed starts of the last hours, merged within, gaps up to, at least. */
  feedHistoryHours: number;
  feedMergeMinutes: number;
  feedGapMaxMinutes: number;
  minimumFeedGaps: number;
  bands: Record<CryAgeBand, CryBandWeights>;
}

/**
 * The generic weights, in one place so a per-baby learner can replace them (phase 2). Every
 * number is a conservative everyday default, not a clinical threshold; see the design doc.
 */
export const CRY_WEIGHTS: CryWeights = {
  likelyFrom: 0.6,
  possibleFrom: 0.3,
  noDataScore: 0.4,
  freshFeedMinutes: 15,
  freshDiaperMinutes: 20,
  freshCap: 0.1,
  runningFeedScore: 0.05,
  postFeedMinutes: 30,
  staleDiaperHours: 4,
  eveningFromHour: 17,
  eveningUntilHour: 23,
  feedHistoryHours: 72,
  feedMergeMinutes: 30,
  feedGapMaxMinutes: 8 * 60,
  minimumFeedGaps: 4,
  bands: {
    newborn: {
      feedGapMinutes: 150,
      wakeWindowMinutes: 60,
      diaperGapMinutes: 120,
      hunger: { floor: 0.1, max: 0.9, rampFrom: 0.4, rampTo: 1.0 },
      sleepy: {
        floor: 0.05,
        max: 0.85,
        rampFrom: 0.6,
        rampTo: 1.0,
        overtiredBoost: 0.1,
        nightFloor: 0.45,
      },
      diaper: {
        floor: 0.05,
        max: 0.75,
        rampFrom: 0.7,
        rampTo: 1.5,
        dirtyDueBoost: 0.3,
        staleFloor: 0.6,
      },
      gas: {
        base: 0.15,
        postFeed: 0.4,
        postFeedRelieved: 0.1,
        bellyPattern: 0.3,
        eveningPattern: 0.15,
        eveningGeneric: 0.1,
        max: 0.9,
      },
      comfort: 0.3,
    },
    weeks6to3m: {
      feedGapMinutes: 180,
      wakeWindowMinutes: 90,
      diaperGapMinutes: 150,
      hunger: { floor: 0.05, max: 0.9, rampFrom: 0.5, rampTo: 1.1 },
      sleepy: {
        floor: 0.05,
        max: 0.85,
        rampFrom: 0.6,
        rampTo: 1.0,
        overtiredBoost: 0.1,
        nightFloor: 0.45,
      },
      diaper: {
        floor: 0.05,
        max: 0.75,
        rampFrom: 0.7,
        rampTo: 1.5,
        dirtyDueBoost: 0.3,
        staleFloor: 0.6,
      },
      gas: {
        base: 0.15,
        postFeed: 0.4,
        postFeedRelieved: 0.1,
        bellyPattern: 0.3,
        eveningPattern: 0.15,
        eveningGeneric: 0.1,
        max: 0.9,
      },
      comfort: 0.3,
    },
    months3to6: {
      feedGapMinutes: 210,
      wakeWindowMinutes: 120,
      diaperGapMinutes: 180,
      hunger: { floor: 0.05, max: 0.9, rampFrom: 0.55, rampTo: 1.1 },
      sleepy: {
        floor: 0.05,
        max: 0.85,
        rampFrom: 0.6,
        rampTo: 1.0,
        overtiredBoost: 0.1,
        nightFloor: 0.45,
      },
      diaper: {
        floor: 0.05,
        max: 0.75,
        rampFrom: 0.7,
        rampTo: 1.5,
        dirtyDueBoost: 0.3,
        staleFloor: 0.6,
      },
      gas: {
        base: 0.1,
        postFeed: 0.35,
        postFeedRelieved: 0.1,
        bellyPattern: 0.3,
        eveningPattern: 0.15,
        eveningGeneric: 0,
        max: 0.9,
      },
      comfort: 0.3,
    },
    months6plus: {
      feedGapMinutes: 240,
      wakeWindowMinutes: 180,
      diaperGapMinutes: 210,
      hunger: { floor: 0.05, max: 0.9, rampFrom: 0.6, rampTo: 1.2 },
      sleepy: {
        floor: 0.05,
        max: 0.85,
        rampFrom: 0.6,
        rampTo: 1.0,
        overtiredBoost: 0.1,
        nightFloor: 0.45,
      },
      diaper: {
        floor: 0.05,
        max: 0.75,
        rampFrom: 0.7,
        rampTo: 1.5,
        dirtyDueBoost: 0.3,
        staleFloor: 0.6,
      },
      gas: {
        base: 0.1,
        postFeed: 0.3,
        postFeedRelieved: 0.05,
        bellyPattern: 0.3,
        eveningPattern: 0.15,
        eveningGeneric: 0,
        max: 0.9,
      },
      comfort: 0.3,
    },
  },
};

/** Event type keys that count as a burp or belly massage (only `belly_massage` is built in). */
export const GAS_RELIEF_KEYS: readonly string[] = [BELLY_MASSAGE_KEY, 'burp', 'burping'];

export interface CryReasonInput {
  events: readonly BabyEvent[];
  types: readonly EventType[];
  now: Date;
  /** `yyyy-mm-dd`; missing or invalid uses `DEFAULT_CRY_AGE_BAND`. */
  birthDate: string | null | undefined;
  /** The cached predictions response; `null` when missing or offline without a cache. */
  predictions: PredictionsDto | null | undefined;
  /** Replaces `CRY_WEIGHTS` (tests, a later learner). */
  weights?: CryWeights;
  /**
   * The published age norms on the device: under 6 months they replace the band's guessed
   * `feedGapMinutes` when a usable norm covers the baby's age and milk (`normFeedGapMinutes`).
   * Without them the band's value is used, as before.
   */
  ageNorms?: AgeNormSet | null;
}

const BIRTH_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The age band at `now`, or `null` without a valid, past birth date. */
export function cryAgeBand(birthDate: string | null | undefined, now: Date): CryAgeBand | null {
  const months = ageInMonths(birthDate, now);
  if (months === null) return null;
  if (months >= 6) return 'months6plus';
  if (months >= 3) return 'months3to6';
  const match = BIRTH_DATE.exec(birthDate as string) as RegExpExecArray;
  const birth = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((today - birth) / DAY_MS) < 42 ? 'newborn' : 'weeks6to3m';
}

/**
 * Published feed norms seed the default gap only in the first 4 weeks (the AAP gap for breastfed
 * newborns). From day 28 the band's own default stays: the one published figure for 4 weeks to
 * 6 months is a flat 11 feeds a day (131 min), which is too short for a 3 to 6 month old, so it
 * waits for an age-banded, reviewed norm (owner decision 2026-10-24, docs/design/28 section 15).
 */
export const CRY_NORM_MAX_AGE_DAYS = 28;

type Milk = 'breastfed' | 'formula' | null;

/** What a logged feed was: breast milk (breast or an expressed-milk bottle), formula, or unknown. */
function milkOf(feed: BabyEvent): Milk | 'solid' {
  const method = payloadString(feed, 'method');
  if (method === 'solid') return 'solid';
  if (method === 'breast') return 'breastfed';
  if (method !== 'bottle') return null;
  const content = payloadString(feed, 'bottle_feeding_type');
  if (content === 'breast_milk') return 'breastfed';
  const formulaNamed =
    payloadValue(feed, 'formula_id') != null || payloadString(feed, 'formula_name');
  return content === 'formula' || formulaNamed ? 'formula' : null;
}

/**
 * The population of the norms that describe her milk feeds: `breastfed` when every logged milk
 * feed was breast milk, `formula` when every one was formula, else `null` (mixed, unknown or none).
 */
export function milkPopulationOf(feeds: readonly BabyEvent[]): AgeNormPopulation | null {
  const kinds = new Set(
    feeds.map(milkOf).filter((kind): kind is Exclude<Milk, null> | null => kind !== 'solid'),
  );
  if (kinds.size !== 1) return null;
  const [only] = kinds;
  return only;
}

/**
 * The published usual gap between feeds (minutes) for her age and milk, or `null`: only under
 * `CRY_NORM_MAX_AGE_DAYS`, only from a norm usable as a prior (not low confidence, not needing
 * review), from the published gap when there is a central value, else from the published feeds a
 * day (24 h / typical count: the mean gap of that many feeds). Ranges without a central value are
 * not turned into a number.
 */
export function normFeedGapMinutes(
  norms: AgeNormSet | null | undefined,
  birthDate: string | null | undefined,
  now: Date,
  feeds: readonly BabyEvent[],
): number | null {
  const ageDays = ageInDaysAt(birthDate, now);
  if (!norms || ageDays === null || ageDays >= CRY_NORM_MAX_AGE_DAYS) return null;
  const population = milkPopulationOf(feeds);
  if (!population) return null;
  const gap = priorFor(norms, AGE_NORM_METRICS.feedGapMinutes, population, ageDays)?.typical;
  if (gap != null && gap > 0) return Math.round(gap);
  const perDay = priorFor(norms, AGE_NORM_METRICS.feedsPer24h, population, ageDays)?.typical;
  return perDay != null && perDay > 0 ? Math.round((24 * 60) / perDay) : null;
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/** `floor` until `rampFrom`, linear up to `max` at `rampTo`, `max` after. */
function ramp(ratio: number, r: CryRamp): number {
  const t = clamp01((ratio - r.rampFrom) / (r.rampTo - r.rampFrom));
  return r.floor + (r.max - r.floor) * t;
}

/** The median of a non-empty list. */
export function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

interface Scored {
  score: number;
  facts: CryFact[];
}

interface Context {
  input: CryReasonInput;
  w: CryWeights;
  band: CryBandWeights;
  nowMs: number;
  past: BabyEvent[];
  feeds: BabyEvent[];
  /** Her feed gap when she has none of her own: the published one, else the band's. */
  defaultFeedGapMinutes: number;
}

const noData = (w: CryWeights, reason: 'noLog' | 'asleep'): Scored => ({
  score: w.noDataScore,
  facts: [{ kind: 'noData', reason }],
});

/** One gap between two feed sessions: when the first one started (ms) and the gap (minutes). */
export interface FeedSessionGap {
  from: number;
  minutes: number;
}

/**
 * Her recent feed gaps, as the cry ranker reads them: the feed starts of the last
 * `feedHistoryHours` up to `nowMs`, merged into sessions when closer than `feedMergeMinutes`, and
 * the start-to-start gaps up to `feedGapMaxMinutes` (longer ones are a missed log, not a gap).
 */
export function feedSessionGaps(
  feeds: readonly BabyEvent[],
  nowMs: number,
  w: Pick<CryWeights, 'feedHistoryHours' | 'feedMergeMinutes' | 'feedGapMaxMinutes'> = CRY_WEIGHTS,
): FeedSessionGap[] {
  const from = nowMs - w.feedHistoryHours * HOUR_MS;
  const starts = feeds
    .map((e) => Date.parse(e.startedAt))
    .filter((t) => t >= from)
    .sort((a, b) => a - b);
  const sessions: number[] = [];
  for (const start of starts) {
    const last = sessions[sessions.length - 1];
    if (last === undefined || start - last >= w.feedMergeMinutes * MINUTE_MS) sessions.push(start);
  }
  return sessions
    .slice(1)
    .map((start, i) => ({ from: sessions[i], minutes: (start - sessions[i]) / MINUTE_MS }))
    .filter((gap) => gap.minutes <= w.feedGapMaxMinutes);
}

/** The usual gap (minutes) of the server's feeding prediction `basis`, when plausible (30 min to 12 h). */
export function serverFeedGapMinutes(
  predictions: PredictionsDto | null | undefined,
): number | null {
  const basis = predictions?.predictions?.find((p) => p.typeKey === FEEDING_KEY)?.basis;
  const server = basis && typeof basis === 'object' ? getOwn(basis, 'medianGapMinutes') : undefined;
  return typeof server === 'number' && Number.isFinite(server) && server >= 30 && server <= 720
    ? Math.round(server)
    : null;
}

/** Her usual feed gap: the local median of recent start-to-start gaps, else the server's. */
function usualFeedGap(ctx: Context): number | null {
  const gaps = feedSessionGaps(ctx.feeds, ctx.nowMs, ctx.w).map((gap) => gap.minutes);
  if (gaps.length >= ctx.w.minimumFeedGaps) return Math.round(median(gaps));
  return serverFeedGapMinutes(ctx.input.predictions);
}

function hungerOf(ctx: Context): Scored {
  const { w, band, input } = ctx;
  if (ctx.feeds.length === 0) return noData(w, 'noLog');
  const running = ctx.feeds
    .filter((e) => e.endedAt === null)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
  if (running) {
    return {
      score: w.runningFeedScore,
      facts: [{ kind: 'feedingNow', minutes: minutesBetween(running.startedAt, input.now) }],
    };
  }
  const lastStart = ctx.feeds.reduce((max, e) => (e.startedAt > max ? e.startedAt : max), '');
  const minutes = minutesBetween(lastStart, input.now);
  const own = usualFeedGap(ctx);
  // A smaller feed than usual (an interrupted bottle) brings the next one forward, bounded.
  const topUp = topUpAdjustment(ctx.feeds, new Date(ctx.nowMs));
  const gap = adjustedFeedGap(own ?? ctx.defaultFeedGapMinutes, topUp);
  let score = ramp(minutes / gap, band.hunger);
  const lastEnd = latestFeedEnd(input.events, input.types, input.now);
  if (lastEnd !== undefined && ctx.nowMs - lastEnd < w.freshFeedMinutes * MINUTE_MS) {
    score = Math.min(score, w.freshCap);
  }
  return {
    score,
    facts: [
      {
        kind: 'sinceLastFeed',
        minutes,
        usualGapMinutes: own,
        ...(topUp ? { smallerFeed: true as const } : {}),
      },
    ],
  };
}

/** The awake stretch to judge, or `null` when the state is unknown (no sleep logged). */
function awakeStretch(ctx: Context, state: ReturnType<typeof deriveNowState>) {
  const { input } = ctx;
  if (state.kind === 'asleep') {
    return state.nightWaking ? { minutes: state.nightWaking.minutes, night: true } : null;
  }
  if (state.kind !== 'awake') return null;
  const night =
    state.sleepKindHint === 'night' ||
    nightWakingSince(new Date(state.since).toISOString(), input.events, input.types, input.now);
  return { minutes: state.awakeMinutes, night };
}

function sleepyOf(ctx: Context, state: ReturnType<typeof deriveNowState>): Scored {
  const { w, band, input } = ctx;
  const stretch = awakeStretch(ctx, state);
  if (!stretch) return noData(w, 'noLog');
  const windowMinutes = wakeWindowOf(input.predictions)?.limitMinutes ?? null;
  let score = ramp(stretch.minutes / (windowMinutes ?? band.wakeWindowMinutes), band.sleepy);
  const overtired = overtiredSuggestion({
    predictions: input.predictions,
    state,
    events: input.events,
    types: input.types,
    now: input.now,
    dismissedSince: null,
  });
  if (overtired) score += band.sleepy.overtiredBoost;
  const facts: CryFact[] = [{ kind: 'awakeFor', minutes: stretch.minutes, windowMinutes }];
  if (stretch.night) {
    score = Math.max(score, band.sleepy.nightFloor);
    facts.push({ kind: 'nightTime' });
  }
  return { score, facts };
}

function diaperOf(ctx: Context): Scored {
  const { w, band, input } = ctx;
  const ids = typeIdsForKey(input.types, DIAPER_KEY);
  const latest = ctx.past
    .filter((e) => ids.has(e.typeId))
    .reduce((max, e) => (e.startedAt > max ? e.startedAt : max), '');
  if (!latest) return noData(w, 'noLog');
  const minutes = minutesBetween(latest, input.now);
  const own = diaperPredictionsOf(input.predictions)?.wet?.medianGapMinutes ?? null;
  let score = ramp(minutes / (own ?? band.diaperGapMinutes), band.diaper);
  const facts: CryFact[] = [{ kind: 'sinceLastDiaper', minutes, usualGapMinutes: own }];
  if (minutes < w.freshDiaperMinutes) return { score: Math.min(score, w.freshCap), facts };
  const dirty = dirtySuggestion({
    predictions: input.predictions,
    events: input.events,
    types: input.types,
    now: input.now,
    dismissedAnchor: null,
  });
  if (dirty) {
    score += band.diaper.dirtyDueBoost;
    facts.push({
      kind: 'dirtyDue',
      signal: dirty.signal,
      expectedAt: dirty.window.expected.toISOString(),
    });
  }
  if (minutes >= w.staleDiaperHours * 60) score = Math.max(score, band.diaper.staleFloor);
  return { score, facts };
}

/** A burp or belly massage that started at or after `fromMs`, or one still running. */
function reliefSince(ctx: Context, fromMs: number): boolean {
  const ids = new Set(GAS_RELIEF_KEYS.flatMap((key) => [...typeIdsForKey(ctx.input.types, key)]));
  return ctx.past.some(
    (e) => ids.has(e.typeId) && (Date.parse(e.startedAt) >= fromMs || e.endedAt === null),
  );
}

/** The latest finished milk feed (breast, bottle or no method; solids excluded). */
function latestMilkFeed(ctx: Context): BabyEvent | undefined {
  return ctx.feeds
    .filter(
      (e) =>
        e.endedAt !== null &&
        Date.parse(e.endedAt) <= ctx.nowMs &&
        payloadString(e, 'method') !== 'solid',
    )
    .sort((a, b) => (b.endedAt as string).localeCompare(a.endedAt as string))[0];
}

function postFeedGas(ctx: Context): Scored | null {
  const { w, band } = ctx;
  const feed = latestMilkFeed(ctx);
  if (!feed) return null;
  const sinceMs = ctx.nowMs - Date.parse(feed.endedAt as string);
  if (sinceMs > w.postFeedMinutes * MINUTE_MS) return null;
  const minutesSinceFeed = Math.floor(sinceMs / MINUTE_MS);
  return reliefSince(ctx, Date.parse(feed.startedAt))
    ? { score: band.gas.postFeedRelieved, facts: [{ kind: 'reliefAfterFeed', minutesSinceFeed }] }
    : { score: band.gas.postFeed, facts: [{ kind: 'recentFeedNoBurp', minutesSinceFeed }] };
}

function patternGas(ctx: Context): Scored[] {
  const { w, band, input } = ctx;
  const parts: Scored[] = [];
  const belly = bellyPainPattern(input.predictions);
  const bellyWindow = belly && windowAround(belly, input.now);
  if (belly && bellyWindow && !reliefSince(ctx, bellyWindow.showFrom.getTime())) {
    parts.push({
      score: band.gas.bellyPattern,
      facts: [{ kind: 'bellyPattern', typicalClock: belly.typicalClock }],
    });
  }
  const fussy = fussyPattern(input.predictions);
  if (fussy && windowAround(fussy, input.now)) {
    parts.push({
      score: band.gas.eveningPattern,
      facts: [{ kind: 'eveningFussy', typicalClock: fussy.typicalClock }],
    });
    return parts;
  }
  const hour = input.now.getHours();
  if (band.gas.eveningGeneric > 0 && hour >= w.eveningFromHour && hour < w.eveningUntilHour) {
    parts.push({
      score: band.gas.eveningGeneric,
      facts: [{ kind: 'eveningFussy', typicalClock: null }],
    });
  }
  return parts;
}

function gasOf(ctx: Context): Scored {
  const { w, band } = ctx;
  const parts = [postFeedGas(ctx), ...patternGas(ctx)].filter((p): p is Scored => p !== null);
  const hasPattern = parts.some((p) => p.facts.some((f) => f.kind === 'bellyPattern'));
  if (ctx.feeds.length === 0 && !hasPattern) return noData(w, 'noLog');
  const score = parts.reduce((sum, p) => sum + p.score, band.gas.base);
  return { score: Math.min(score, band.gas.max), facts: parts.flatMap((p) => p.facts) };
}

function levelOf(score: number, w: CryWeights): CryLevel {
  if (score >= w.likelyFrom) return 'likely';
  return score >= w.possibleFrom ? 'possible' : 'unlikely';
}

const round3 = (value: number) => Math.round(clamp01(value) * 1000) / 1000;

/**
 * Ranks the causes for a crying spell now, from what the log suggests. While a sleep timer runs
 * (and no night waking runs inside it) every cause is a neutral `possible` with a `noData` fact:
 * crying while logged asleep says the log is out of date, not why she cries.
 */
export function rankCryReasons(input: CryReasonInput): CryReasonResult {
  const w = input.weights ?? CRY_WEIGHTS;
  const band = w.bands[cryAgeBand(input.birthDate, input.now) ?? DEFAULT_CRY_AGE_BAND];
  const past = pastLiveEvents(input.events, input.now);
  const feedIds = typeIdsForKey(input.types, FEEDING_KEY);
  const feeds = past.filter((e) => feedIds.has(e.typeId));
  const ctx: Context = {
    input,
    w,
    band,
    nowMs: input.now.getTime(),
    past,
    feeds,
    defaultFeedGapMinutes:
      normFeedGapMinutes(input.ageNorms, input.birthDate, input.now, feeds) ?? band.feedGapMinutes,
  };
  const state = deriveNowState(
    input.events,
    input.types,
    input.predictions ?? undefined,
    input.now,
  );
  const asleep = state.kind === 'asleep' && !state.nightWaking;
  const scored: Record<Exclude<CryCause, 'comfort'>, Scored> = asleep
    ? {
        hunger: noData(w, 'asleep'),
        sleepy: noData(w, 'asleep'),
        diaper: noData(w, 'asleep'),
        gas: noData(w, 'asleep'),
      }
    : {
        hunger: hungerOf(ctx),
        sleepy: sleepyOf(ctx, state),
        diaper: diaperOf(ctx),
        gas: gasOf(ctx),
      };
  // The fallback never outranks a strongly supported cause nor a cause with nothing logged.
  const comfortScore = Math.min(band.comfort, w.likelyFrom - 0.05, w.noDataScore - 0.05);
  const causes: CryCauseRank[] = CRY_CAUSES.map((cause) => {
    if (cause === 'comfort') {
      return { cause, level: 'possible', score: round3(comfortScore), facts: [] };
    }
    const { score, facts } = scored[cause];
    const rounded = round3(score);
    return { cause, level: levelOf(rounded, w), score: rounded, facts };
  });
  const order = (cause: CryCause) => CRY_CAUSES.indexOf(cause);
  causes.sort((a, b) => b.score - a.score || order(a.cause) - order(b.cause));
  return { causes, redFlags: [...CRY_RED_FLAGS], basis: 'generic' };
}

/* ---- Outcome history: what helped in past fussy spells (shown as a hint; not used to rank) ---- */

export type CryOutcome = CryCause | 'none';

/** `what_helped` option keys to causes; unknown keys (and prototype names) map to `none`. */
const WHAT_HELPED_CAUSE: Readonly<Record<string, CryOutcome>> = {
  feeding: 'hunger',
  sleep: 'sleepy',
  diaper_change: 'diaper',
  burping: 'gas',
  massage: 'gas',
  rocking: 'comfort',
  pacifier: 'comfort',
  holding: 'comfort',
  other: 'none',
  nothing: 'none',
};

/** The cause a `what_helped` value points to (`none` for other, nothing and unknown values). */
export function outcomeCause(value: string): CryOutcome {
  return getOwn(WHAT_HELPED_CAUSE, value.trim()) ?? 'none';
}

export interface CryOutcomeStat {
  /** Spells where this cause's remedy helped... */
  helped: number;
  /** ...out of the answered spells considered. */
  total: number;
}

export interface CryOutcomeHistory {
  /** Answered spells considered (newest first, at most `limit`). */
  spells: number;
  byCause: Record<CryCause, CryOutcomeStat>;
  /** Answered spells where nothing, something else or an unknown option helped. */
  none: number;
}

/** The `what_helped` answers of a spell: a string, or (defensively) a list of strings. */
function whatHelped(event: BabyEvent): string[] {
  const value = payloadValue(event, 'what_helped');
  const values = Array.isArray(value) ? (value as unknown[]) : [value];
  return values.filter((v): v is string => typeof v === 'string' && v.trim() !== '');
}

/**
 * What helped in the last `limit` answered fussy spells (live, started by `now`), per cause. A
 * spell without a `what_helped` answer is skipped; one whose answer is unknown counts as `none`.
 * A cry monitor spell marked "Not crying" is never counted (a false alarm, not a crying spell).
 */
export function cryOutcomeHistory(
  events: readonly BabyEvent[],
  types: readonly EventType[],
  now: Date,
  limit = 10,
): CryOutcomeHistory {
  const ids = typeIdsForKey(types, FUSSY_KEY);
  const max = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : Number.MAX_SAFE_INTEGER;
  const answered = pastLiveEvents(events, now)
    .filter((e) => ids.has(e.typeId) && countsAsCrying(e))
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt) || a.id.localeCompare(b.id))
    .map(whatHelped)
    .filter((answers) => answers.length > 0)
    .slice(0, max);
  const byCause = Object.fromEntries(
    CRY_CAUSES.map((cause) => [cause, { helped: 0, total: answered.length }]),
  ) as Record<CryCause, CryOutcomeStat>;
  let none = 0;
  for (const answers of answered) {
    const causes = new Set(answers.map(outcomeCause));
    causes.delete('none');
    if (causes.size === 0) none += 1;
    for (const cause of causes) byCause[cause as CryCause].helped += 1;
  }
  return { spells: answered.length, byCause, none };
}
