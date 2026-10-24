import { ageInDaysAt, type AgeNormSet } from '../ageNorms/ageNorms';
import type { BabyEvent, DayPart, EventType } from '../db/models';
import { normBottleRange } from '../events/bottleAgeDefaults';
import { drunkMl } from '../events/bottleAmounts';
import { adjustedFeedGap, topUpAdjustment } from '../events/bottlePatterns';
import { roundToStep } from '../events/bottleSuggestions';
import { DAY_PARTS, partAt } from '../medications/dayParts';
import type { MedicationStatus } from '../medications/statusCalculator';
import type { PredictionConfidence, PredictionsDto } from '../sync/contract';
import { bellyPainPattern, isHandled, occurrenceOn, type PatternWindow } from './bellyPattern';
import {
  CRY_WEIGHTS,
  feedSessionGaps,
  median,
  normFeedGapMinutes,
  serverFeedGapMinutes,
} from './cryReasons';
import { dirtyEstimate, FEEDING_KEY, wetEstimate } from './diaperPredictions';
import { DAY_MS, MINUTE_MS, pastLiveEvents, payloadString, typeIdsForKey } from './eventFacts';
import { fussyPattern, isFussyHandled } from './fussyPattern';
import { dayFrame } from './ringGeometry';

/*
 * "Next up" on the day ring and the ruler (docs/DESIGN.md "Now: next up on the ring"): what is
 * likely still to come today, from what the app already estimates elsewhere and nothing else. The
 * next feed (the server's feeding prediction, else her usual gap after the last feed, the cry
 * ranker's rule; earlier after a smaller bottle than usual, the ranker's partial-feed rule) with
 * the amount she usually drinks at that part of the day, the next wet and
 * dirty diaper (the diaper cards' estimates without their timing gate), the belly pain and fussy
 * windows (the pattern cards' windows) and the scheduled doses of active prescriptions (the Meds
 * calculator). Pure, offline and language-free: the ring writes the sentences. Estimates only:
 * never a judgement, an alarm or advice, never a number without its basis.
 */

export type UpcomingKind =
  'feed' | 'diaperWet' | 'diaperDirty' | 'bellyPain' | 'fussy' | 'medicine';
export type UpcomingConfidence = 'high' | 'medium' | 'low';

/** The layers the parent can show or hide on the ring (`sleep` is the existing sleep marks). */
export type RingLayer = 'sleep' | 'feeds' | 'diapers' | 'patterns' | 'medicine';
export const RING_LAYERS: readonly RingLayer[] = [
  'sleep',
  'feeds',
  'diapers',
  'patterns',
  'medicine',
];
export const DEFAULT_RING_LAYERS: readonly RingLayer[] = ['sleep', 'feeds', 'diapers'];

/** The layer an item is drawn on. */
export const LAYER_OF: Readonly<Record<UpcomingKind, Exclude<RingLayer, 'sleep'>>> = {
  feed: 'feeds',
  diaperWet: 'diapers',
  diaperDirty: 'diapers',
  bellyPain: 'patterns',
  fussy: 'patterns',
  medicine: 'medicine',
};

/** Never more items than this (the earliest ones). */
export const MAX_UPCOMING = 8;
/** The bottles whose amounts count. */
export const AMOUNT_HISTORY_DAYS = 14;
/** Fewer bottles than this at a part of the day: all her bottles; fewer overall: the age norm. */
export const MIN_AMOUNT_SAMPLES = 3;
/** Fewer dirty diapers (or feed pairs) than this behind the estimate: no poop item. */
export const MIN_DIRTY_SAMPLES = 3;
/** A dirty-diaper gap in this range reads "about once a day". */
const ONCE_A_DAY_MINUTES = [20 * 60, 28 * 60] as const;

/** How the time of the next feed was found. */
export type FeedTimeBasis =
  /** The server's feeding prediction (`samples` feeds behind it). */
  | { kind: 'prediction'; samples: number }
  /** Her own usual gap after the last feed: at that part of the day, or over all parts (`null`). */
  | { kind: 'ownGap'; gapMinutes: number; dayPart: DayPart | null; samples: number }
  /** The gap of the server's feeding prediction basis, after the last local feed. */
  | { kind: 'serverGap'; gapMinutes: number }
  /** The published gap for her age and milk (only where the cry ranker already allows it). */
  | { kind: 'ageNorm'; gapMinutes: number };

/** The usual drunk amount at one part of the day (parts with enough bottles only). */
export interface PartAmount {
  dayPart: DayPart;
  typicalMl: number;
  samples: number;
}

/** Where the expected amount comes from. */
export type FeedAmountBasis =
  /** Her bottles at that part of the day over the last 14 days. */
  | { kind: 'dayPart'; dayPart: DayPart; samples: number; days: number; byPart: PartAmount[] }
  /** Too few at that part: all her bottles of the last 14 days. */
  | { kind: 'allBottles'; dayPart: DayPart; samples: number; days: number; byPart: PartAmount[] }
  /** Too few bottles of her own: the published range for her age (a usable norm only). */
  | { kind: 'ageNorm'; normId: string };

/**
 * The last bottle was well under her usual amount (the cry ranker's partial-feed rule,
 * `topUpAdjustment`): the expected time moved earlier by `minutesEarlier`.
 */
export interface PartialFeedBasis {
  /** What she drank at the last feed and what she usually drinks then (ml). */
  drunkMl: number;
  usualMl: number;
  /** A sleep stopped that feed. */
  endedBySleep: boolean;
  minutesEarlier: number;
}

export interface FeedBasis {
  kind: 'feed';
  time: FeedTimeBasis;
  /** Present only when a partial feed brought the expected time forward. */
  partialFeed?: PartialFeedBasis;
  /** What her recent feeds at that part of the day mostly were (`null`: unknown or none). */
  method: 'bottle' | 'breast' | null;
  amount: FeedAmountBasis | null;
  /** The part of the day of the expected time. */
  dayPart: DayPart;
  /** The expected time has passed (she may be hungry any time now); `at` is then now. */
  due: boolean;
}

export interface DiaperBasis {
  kind: 'diaper';
  /** `afterFeed`: the usual lag after the latest feed; `gap`: the usual gap since the last one. */
  signal: 'gap' | 'afterFeed';
  medianMinutes: number;
  samples: number;
  /** The gap reads "about once a day". */
  daily: boolean;
  due: boolean;
}

export interface PatternBasis {
  kind: 'pattern';
  /** The usual time (local `HH:mm` of the server). */
  typicalClock: string;
  /** Days of the log behind the pattern. */
  days: number;
  due: boolean;
}

export interface MedicineBasis {
  kind: 'medicine';
  name: string;
  prescriptionId: string;
  /** A clock time, a part of the day, or every N minutes after the last dose. */
  schedule: 'time' | 'dayPart' | 'interval';
  dayPart?: DayPart;
  /** The reminder time of the part, when the prescription has one. */
  reminderAt?: Date;
  everyMinutes?: number;
}

export type UpcomingBasis = FeedBasis | DiaperBasis | PatternBasis | MedicineBasis;

export interface UpcomingAmount {
  low: number;
  /** `null` for a published range without a central value. */
  typical: number | null;
  high: number;
}

export interface UpcomingItem {
  /** Stable while the estimate holds (the ring's mark key). */
  key: string;
  kind: UpcomingKind;
  /** The expected time (never before now). */
  at: Date;
  windowStart?: Date;
  windowEnd?: Date;
  confidence: UpcomingConfidence;
  basis: UpcomingBasis;
  amountMl?: UpcomingAmount;
}

export interface MedicineInput {
  status: MedicationStatus;
  name: string;
}

export interface UpcomingInput {
  /** The Now events (the last days, running timers included). */
  events: readonly BabyEvent[];
  /** Longer history for the bottle amounts (the bottle chips' 30 days); `events` when absent. */
  history?: readonly BabyEvent[];
  types: readonly EventType[];
  now: Date;
  birthDate?: string | null;
  predictions?: PredictionsDto | null;
  ageNorms?: AgeNormSet | null;
  /** The Meds calculator's statuses with the medication names. */
  medicines?: readonly MedicineInput[];
}

const CONFIDENCE: Record<PredictionConfidence, UpcomingConfidence> = {
  High: 'high',
  Medium: 'medium',
  Low: 'low',
};
const RANK: Record<UpcomingConfidence, number> = { low: 0, medium: 1, high: 2 };
const KIND_ORDER: readonly UpcomingKind[] = [
  'feed',
  'diaperWet',
  'diaperDirty',
  'bellyPain',
  'fussy',
  'medicine',
];

const confidenceOf = (value: unknown): UpcomingConfidence =>
  typeof value === 'string' && Object.hasOwn(CONFIDENCE, value)
    ? CONFIDENCE[value as PredictionConfidence]
    : 'low';

const lower = (a: UpcomingConfidence, b: UpcomingConfidence) => (RANK[a] <= RANK[b] ? a : b);

const pad = (n: number) => String(n).padStart(2, '0');

/** The part of the day of a local instant (the medications' fixed windows). */
export function dayPartAt(ms: number): DayPart {
  const date = new Date(ms);
  return partAt(`${pad(date.getHours())}:${pad(date.getMinutes())}`);
}

const isInstant = (value: unknown): value is string =>
  typeof value === 'string' && Number.isFinite(Date.parse(value));

/** The value at fraction `p` of a sorted list (linear between neighbours). */
function quantile(sorted: readonly number[], p: number): number {
  const index = (sorted.length - 1) * p;
  const below = Math.floor(index);
  const above = Math.ceil(index);
  return sorted[below] + (sorted[above] - sorted[below]) * (index - below);
}

/* ---------- feeds ---------- */

interface FeedTime {
  at: number;
  windowStart?: number;
  windowEnd?: number;
  confidence: UpcomingConfidence;
  basis: FeedTimeBasis;
}

/** The server's next feed, unless a feed was logged since it was made or inside its window. */
function predictedFeed(input: UpcomingInput, starts: readonly number[]): FeedTime | null {
  const prediction = input.predictions?.predictions?.find((p) => p.typeKey === FEEDING_KEY);
  const next = prediction?.nextStart;
  if (!prediction || !next || ![next.earliest, next.expected, next.latest].every(isInstant)) {
    return null;
  }
  const earliest = Date.parse(next.earliest);
  const latest = Date.parse(next.latest);
  const generatedAt = input.predictions?.generatedAt;
  const generated = isInstant(generatedAt) ? Date.parse(generatedAt) : -Infinity;
  const done = starts.some((start) => start > generated || (start >= earliest && start <= latest));
  if (done || latest <= input.now.getTime()) return null;
  return {
    at: Date.parse(next.expected),
    windowStart: earliest,
    windowEnd: latest,
    confidence: confidenceOf(prediction.confidence),
    basis: { kind: 'prediction', samples: prediction.sampleCount },
  };
}

/** Her usual gap after the last feed: that part of the day, all parts, the server's, the norm. */
function gapFeed(input: UpcomingInput, feeds: readonly BabyEvent[], last: number): FeedTime | null {
  const nowMs = input.now.getTime();
  const gaps = feedSessionGaps(feeds, nowMs);
  const part = dayPartAt(last);
  const atPart = gaps.filter((gap) => dayPartAt(gap.from) === part).map((gap) => gap.minutes);
  const all = gaps.map((gap) => gap.minutes);
  const minimum = CRY_WEIGHTS.minimumFeedGaps;
  let basis: FeedTimeBasis | null = null;
  if (atPart.length >= minimum) {
    basis = {
      kind: 'ownGap',
      gapMinutes: Math.round(median(atPart)),
      dayPart: part,
      samples: atPart.length,
    };
  } else if (all.length >= minimum) {
    basis = {
      kind: 'ownGap',
      gapMinutes: Math.round(median(all)),
      dayPart: null,
      samples: all.length,
    };
  } else {
    const server = serverFeedGapMinutes(input.predictions);
    const norm =
      server === null
        ? normFeedGapMinutes(input.ageNorms, input.birthDate, input.now, feeds)
        : null;
    if (server !== null) basis = { kind: 'serverGap', gapMinutes: server };
    else if (norm !== null) basis = { kind: 'ageNorm', gapMinutes: norm };
  }
  if (!basis) return null;
  return {
    at: last + basis.gapMinutes * MINUTE_MS,
    confidence: basis.kind === 'ageNorm' ? 'low' : 'medium',
    basis,
  };
}

/**
 * A smaller last bottle than usual brings the next feed forward: the cry ranker's rule
 * (`topUpAdjustment` and `adjustedFeedGap`, bounded at `MAX_TOP_UP_SHARE` of the gap) applied to
 * the gap from the last feed to the expected time. A server window keeps its end and opens as
 * much earlier. Unchanged without a partial feed.
 */
function partialFeedEarlier(
  time: FeedTime,
  feeds: readonly BabyEvent[],
  last: number,
  now: Date,
): { time: FeedTime; partial: PartialFeedBasis | null } {
  const gapMinutes = Math.round((time.at - last) / MINUTE_MS);
  const topUp = gapMinutes > 0 ? topUpAdjustment(feeds, now) : null;
  const minutesEarlier = gapMinutes - adjustedFeedGap(gapMinutes, topUp);
  if (!topUp || minutesEarlier <= 0) return { time, partial: null };
  const shift = minutesEarlier * MINUTE_MS;
  return {
    time: {
      ...time,
      at: time.at - shift,
      ...(time.windowStart !== undefined ? { windowStart: time.windowStart - shift } : {}),
    },
    partial: {
      drunkMl: topUp.drunkMl,
      usualMl: topUp.usualMl,
      endedBySleep: topUp.endedBySleep,
      minutesEarlier,
    },
  };
}

/** What her recent feeds at a part of the day mostly were (all parts when none at it). */
function methodAt(feeds: readonly BabyEvent[], part: DayPart): 'bottle' | 'breast' | null {
  const methods = (list: readonly BabyEvent[]) =>
    list
      .map((feed) => payloadString(feed, 'method'))
      .filter((m): m is 'bottle' | 'breast' => m === 'bottle' || m === 'breast');
  const atPart = methods(feeds.filter((feed) => dayPartAt(Date.parse(feed.startedAt)) === part));
  const pool = atPart.length > 0 ? atPart : methods(feeds);
  if (pool.length === 0) return null;
  const breast = pool.filter((m) => m === 'breast').length;
  return breast * 2 > pool.length ? 'breast' : 'bottle';
}

function amountOf(values: readonly number[]): UpcomingAmount {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    low: roundToStep(quantile(sorted, 0.25)),
    typical: roundToStep(median(sorted)),
    high: roundToStep(quantile(sorted, 0.75)),
  };
}

/**
 * The amount expected at `part`: the median (and quartiles) of her drunk bottle amounts at that
 * part of the day over the last 14 days; with fewer than 3 there, of all her bottles; with fewer
 * than 3 overall, the published range for her age (a usable norm only); else nothing.
 */
function expectedAmount(
  input: UpcomingInput,
  bottles: readonly { part: DayPart; ml: number }[],
  part: DayPart,
): { amount: UpcomingAmount; basis: FeedAmountBasis } | null {
  const byPart: PartAmount[] = DAY_PARTS.flatMap((dayPart) => {
    const values = bottles.filter((b) => b.part === dayPart).map((b) => b.ml);
    return values.length >= MIN_AMOUNT_SAMPLES
      ? [{ dayPart, typicalMl: roundToStep(median(values)), samples: values.length }]
      : [];
  });
  const atPart = bottles.filter((b) => b.part === part).map((b) => b.ml);
  if (atPart.length >= MIN_AMOUNT_SAMPLES) {
    return {
      amount: amountOf(atPart),
      basis: {
        kind: 'dayPart',
        dayPart: part,
        samples: atPart.length,
        days: AMOUNT_HISTORY_DAYS,
        byPart,
      },
    };
  }
  if (bottles.length >= MIN_AMOUNT_SAMPLES) {
    return {
      amount: amountOf(bottles.map((b) => b.ml)),
      basis: {
        kind: 'allBottles',
        dayPart: part,
        samples: bottles.length,
        days: AMOUNT_HISTORY_DAYS,
        byPart,
      },
    };
  }
  const norm = normBottleRange(input.ageNorms, ageInDaysAt(input.birthDate, input.now));
  if (!norm) return null;
  return {
    amount: { low: norm.minMl, typical: null, high: norm.maxMl },
    basis: { kind: 'ageNorm', normId: norm.normId },
  };
}

function feedItem(input: UpcomingInput): UpcomingItem | null {
  const nowMs = input.now.getTime();
  const ids = typeIdsForKey(input.types, FEEDING_KEY);
  const feeds = pastLiveEvents(input.events, input.now).filter((e) => ids.has(e.typeId));
  const starts = feeds.map((feed) => Date.parse(feed.startedAt));
  const last = starts.length > 0 ? Math.max(...starts) : undefined;
  const usual =
    predictedFeed(input, starts) ?? (last === undefined ? null : gapFeed(input, feeds, last));
  if (!usual) return null;
  const { time, partial } =
    last === undefined
      ? { time: usual, partial: null }
      : partialFeedEarlier(usual, feeds, last, input.now);
  const expected = time.at;
  const overdueBy = nowMs - expected;
  // Long past the usual gap the log is likely incomplete: no guess.
  if (time.basis.kind !== 'prediction' && overdueBy > 0 && last !== undefined) {
    if (overdueBy > expected - last) return null;
  }
  const due = expected <= nowMs;
  const at = Math.max(expected, nowMs);
  const part = dayPartAt(at);

  const from = new Date(nowMs - AMOUNT_HISTORY_DAYS * DAY_MS).toISOString();
  const recent = pastLiveEvents(input.history ?? input.events, input.now).filter(
    (e) => ids.has(e.typeId) && e.startedAt >= from,
  );
  const method = methodAt(recent, part);
  const bottles = recent.flatMap((e) => {
    const ml = payloadString(e, 'method') === 'bottle' ? drunkMl(e.payload) : undefined;
    return ml !== undefined && ml > 0 ? [{ part: dayPartAt(Date.parse(e.startedAt)), ml }] : [];
  });
  // The published range only stands in for a bottle feeder's own amounts, never for nursing.
  const amount =
    method === 'breast' || (method === null && bottles.length === 0)
      ? null
      : expectedAmount(input, bottles, part);
  const confidence =
    amount?.basis.kind === 'ageNorm' ? lower(time.confidence, 'low') : time.confidence;
  return {
    key: 'feed',
    kind: 'feed',
    at: new Date(at),
    ...(time.windowStart !== undefined ? { windowStart: new Date(time.windowStart) } : {}),
    ...(time.windowEnd !== undefined ? { windowEnd: new Date(time.windowEnd) } : {}),
    confidence,
    basis: {
      kind: 'feed',
      time: time.basis,
      ...(partial ? { partialFeed: partial } : {}),
      method,
      amount: amount?.basis ?? null,
      dayPart: part,
      due,
    },
    ...(amount ? { amountMl: amount.amount } : {}),
  };
}

/* ---------- diapers ---------- */

function diaperItems(input: UpcomingInput): UpcomingItem[] {
  const nowMs = input.now.getTime();
  const estimateInput = {
    predictions: input.predictions,
    events: input.events,
    types: input.types,
    now: input.now,
  };
  const out: UpcomingItem[] = [];
  for (const estimate of [wetEstimate(estimateInput), dirtyEstimate(estimateInput)]) {
    if (!estimate) continue;
    const { window } = estimate;
    if (window.latest.getTime() <= nowMs) continue;
    const dirty = estimate.diaper.dirty;
    const lag = estimate.signal === 'afterFeed' ? dirty?.afterFeed : null;
    const gap = estimate.kind === 'wet' ? estimate.diaper.wet : dirty?.gap;
    const samples = lag ? lag.pairCount : (gap?.gapCount ?? 0);
    if (estimate.kind === 'dirty' && samples < MIN_DIRTY_SAMPLES) continue;
    const medianMinutes = lag ? lag.medianLagMinutes : (gap?.medianGapMinutes ?? 0);
    const expected = window.expected.getTime();
    out.push({
      key: estimate.kind === 'wet' ? 'diaperWet' : 'diaperDirty',
      kind: estimate.kind === 'wet' ? 'diaperWet' : 'diaperDirty',
      at: new Date(Math.max(expected, nowMs)),
      windowStart: window.earliest,
      windowEnd: window.latest,
      confidence: confidenceOf(lag ? lag.confidence : gap?.confidence),
      basis: {
        kind: 'diaper',
        signal: estimate.signal,
        medianMinutes,
        samples,
        daily:
          !lag && medianMinutes >= ONCE_A_DAY_MINUTES[0] && medianMinutes <= ONCE_A_DAY_MINUTES[1],
        due: expected <= nowMs,
      },
    });
  }
  return out;
}

/* ---------- patterns ---------- */

function patternItems(input: UpcomingInput): UpcomingItem[] {
  const { now, events, types } = input;
  const nowMs = now.getTime();
  const frame = dayFrame(now);
  const sources = [
    {
      kind: 'bellyPain' as const,
      pattern: bellyPainPattern(input.predictions),
      handled: (w: PatternWindow) => isHandled(w, events, types, now),
    },
    {
      kind: 'fussy' as const,
      pattern: fussyPattern(input.predictions),
      handled: (w: PatternWindow) => isFussyHandled(w, events, types, now),
    },
  ];
  const out: UpcomingItem[] = [];
  for (const { kind, pattern, handled } of sources) {
    if (!pattern) continue;
    const window = [-1, 0]
      .map((offset) =>
        occurrenceOn(pattern, new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset)),
      )
      .find((w) => w.end.getTime() > nowMs && w.start.getTime() < frame.end);
    if (!window || handled(window)) continue;
    const typical = window.typical.getTime();
    out.push({
      key: kind,
      kind,
      at: new Date(Math.max(typical, nowMs)),
      windowStart: window.start,
      windowEnd: window.end,
      confidence: confidenceOf(pattern.confidence),
      basis: {
        kind: 'pattern',
        typicalClock: pattern.typicalClock,
        days: pattern.eventDayCount,
        due: typical <= nowMs,
      },
    });
  }
  return out;
}

/* ---------- medicines ---------- */

function medicineItems(input: UpcomingInput): UpcomingItem[] {
  const nowMs = input.now.getTime();
  const frame = dayFrame(input.now);
  const out: UpcomingItem[] = [];
  for (const { status, name } of input.medicines ?? []) {
    const p = status.prescription;
    if (p.kind !== 'scheduled' || !status.courseStarted || status.courseEnded) continue;
    const base = { kind: 'medicine' as const, name, prescriptionId: p.id };
    const push = (
      at: number,
      basis: Omit<MedicineBasis, 'kind' | 'name' | 'prescriptionId'>,
      window?: [number, number],
    ) => {
      out.push({
        key: `medicine-${p.id}-${at}`,
        kind: 'medicine',
        at: new Date(at),
        ...(window ? { windowStart: new Date(window[0]), windowEnd: new Date(window[1]) } : {}),
        confidence: 'high',
        basis: { ...base, ...basis },
      });
    };
    if (status.dayParts) {
      for (const slot of status.dayParts.parts) {
        if (slot.state !== 'upcoming' && slot.state !== 'due') continue;
        const start = slot.start.getTime();
        const end = slot.end.getTime();
        if (end <= nowMs || start >= frame.end) continue;
        const reminder = slot.reminderAt?.getTime();
        const at = reminder !== undefined && reminder > nowMs ? reminder : Math.max(start, nowMs);
        push(
          at,
          {
            schedule: 'dayPart',
            dayPart: slot.part,
            ...(slot.reminderAt ? { reminderAt: slot.reminderAt } : {}),
          },
          [start, end],
        );
      }
      continue;
    }
    const next = status.nextScheduledAt?.getTime();
    if (next === undefined || next <= nowMs || next >= frame.end) continue;
    if (p.timesOfDay) {
      const today = new Date(nowMs);
      const times = [...p.timesOfDay]
        .sort()
        .map((time) => {
          const [h, m] = time.split(':').map(Number);
          return new Date(today.getFullYear(), today.getMonth(), today.getDate(), h, m).getTime();
        })
        .filter((at) => at >= next && at < frame.end);
      for (const at of times) push(at, { schedule: 'time' });
    } else if (p.everyMinutes !== null) {
      push(next, { schedule: 'interval', everyMinutes: p.everyMinutes });
    }
  }
  return out;
}

/**
 * What is likely still to come today, in time order, at most `MAX_UPCOMING` (the earliest): each
 * item's expected time is from now until local midnight (an open window counts from now). Items
 * already done drop out by themselves: a feed logged since the prediction or inside its window, a
 * diaper or a dose that moves the anchor, a belly pain or fussy spell logged in the window.
 */
export function upcomingToday(input: UpcomingInput): UpcomingItem[] {
  const frame = dayFrame(input.now);
  const nowMs = input.now.getTime();
  const feed = feedItem(input);
  return [
    ...(feed ? [feed] : []),
    ...diaperItems(input),
    ...patternItems(input),
    ...medicineItems(input),
  ]
    .filter((item) => item.at.getTime() >= nowMs && item.at.getTime() < frame.end)
    .sort(
      (a, b) =>
        a.at.getTime() - b.at.getTime() ||
        KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) ||
        a.key.localeCompare(b.key),
    )
    .slice(0, MAX_UPCOMING);
}
