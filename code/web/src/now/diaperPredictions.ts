import type { BabyEvent, EventType } from '../db/models';
import type {
  DiaperFeedLagDto,
  DiaperGapDto,
  DiaperPredictionsDto,
  PredictionsDto,
} from '../sync/contract';
import { MINUTE_MS, payloadString, pastLiveEvents, typeIdsForKey } from './eventFacts';

/*
 * The diaper suggestions on Now (docs/design/11-patterns.md section 8): the gaps between wet and
 * dirty diapers and the usual lag after feeds come from the server (the predictions response,
 * cached for offline like the nap window); the anchors (the latest wet or dirty diaper, the latest
 * finished feed) are taken from local events, so a diaper logged a moment ago (or offline) moves
 * the next expected time at once. Pure and language-free; never medical advice.
 */

export const DIAPER_KEY = 'diaper';
export const FEEDING_KEY = 'feeding';
/** The card shows this long before the expected time when the server does not say... */
export const DEFAULT_LEAD_MINUTES = 20;
/** ...and stays this long after it. */
export const DEFAULT_GRACE_MINUTES = 40;
/** A feed counts for this long after it ended when the server does not say. */
export const DEFAULT_FEED_WINDOW_MINUTES = 180;
/** No server sends longer gaps or lags; anything else is ignored as malformed. */
const MAX_GAP_MINUTES = 3 * 24 * 60;
const MAX_LAG_MINUTES = 12 * 60;

export type DiaperKind = 'wet' | 'dirty';
export type DiaperSignal = 'gap' | 'afterFeed';

const contentOf = (event: BabyEvent) => payloadString(event, 'content')?.trim().toUpperCase();

/** A wet diaper is one logged as `WET` or `MIXED`. */
export const isWetDiaper = (event: BabyEvent) => ['WET', 'MIXED'].includes(contentOf(event) ?? '');

/** A dirty diaper is one logged as `DIRTY` or `MIXED`. */
export const isDirtyDiaper = (event: BabyEvent) =>
  ['DIRTY', 'MIXED'].includes(contentOf(event) ?? '');

const isMinutes = (value: unknown, max: number): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= max;

const isInstant = (value: unknown): value is string =>
  typeof value === 'string' && Number.isFinite(Date.parse(value));

function isGap(gap: unknown): gap is DiaperGapDto {
  if (!gap || typeof gap !== 'object') return false;
  const { anchorAt, lowerGapMinutes, medianGapMinutes, upperGapMinutes } = gap as DiaperGapDto;
  return (
    isInstant(anchorAt) &&
    isMinutes(lowerGapMinutes, MAX_GAP_MINUTES) &&
    isMinutes(medianGapMinutes, MAX_GAP_MINUTES) &&
    isMinutes(upperGapMinutes, MAX_GAP_MINUTES) &&
    medianGapMinutes > 0 &&
    lowerGapMinutes <= medianGapMinutes &&
    medianGapMinutes <= upperGapMinutes
  );
}

function isLag(lag: unknown): lag is DiaperFeedLagDto {
  if (!lag || typeof lag !== 'object') return false;
  const { lowerLagMinutes, medianLagMinutes, upperLagMinutes } = lag as DiaperFeedLagDto;
  return (
    isMinutes(lowerLagMinutes, MAX_LAG_MINUTES) &&
    isMinutes(medianLagMinutes, MAX_LAG_MINUTES) &&
    isMinutes(upperLagMinutes, MAX_LAG_MINUTES) &&
    lowerLagMinutes <= medianLagMinutes &&
    medianLagMinutes <= upperLagMinutes
  );
}

/** The well-formed diaper predictions of a response (malformed parts dropped), if any. */
export function diaperPredictionsOf(
  predictions: PredictionsDto | null | undefined,
): DiaperPredictionsDto | null {
  const diaper = predictions?.diaper;
  if (!diaper || typeof diaper !== 'object' || !diaper.rule || typeof diaper.rule !== 'object') {
    return null;
  }
  const dirty = diaper.dirty && typeof diaper.dirty === 'object' ? diaper.dirty : null;
  return {
    wet: isGap(diaper.wet) ? diaper.wet : null,
    dirty: dirty && {
      lastDirtyAt: isInstant(dirty.lastDirtyAt) ? dirty.lastDirtyAt : null,
      gap: isGap(dirty.gap) ? dirty.gap : null,
      afterFeed: isLag(dirty.afterFeed) ? dirty.afterFeed : null,
    },
    rule: diaper.rule,
  };
}

const ruleMinutes = (value: unknown, fallback: number) =>
  isMinutes(value, 24 * 60) ? value : fallback;

/** When the next diaper is expected: the anchor plus the lower, median and upper gap (or lag). */
export interface DiaperWindow {
  anchor: Date;
  earliest: Date;
  expected: Date;
  latest: Date;
}

export interface DiaperSuggestion {
  kind: DiaperKind;
  signal: DiaperSignal;
  /** UTC ISO of the anchor: one card and one "Not now" per anchor. */
  anchorAt: string;
  window: DiaperWindow;
  diaper: DiaperPredictionsDto;
}

export interface DiaperSuggestionInput {
  predictions: PredictionsDto | null | undefined;
  events: readonly BabyEvent[];
  types: readonly EventType[];
  now: Date;
  /** The anchor (UTC ISO) "Not now" was chosen for, if any. */
  dismissedAnchor: string | null;
}

/** The latest start (ms) of the past live diapers that pass `test`, or `undefined`. */
function latestDiaper(
  input: DiaperEstimateInput,
  test: (event: BabyEvent) => boolean,
): number | undefined {
  const ids = typeIdsForKey(input.types, DIAPER_KEY);
  const starts = pastLiveEvents(input.events, input.now)
    .filter((event) => ids.has(event.typeId) && test(event))
    .map((event) => Date.parse(event.startedAt));
  return starts.length ? Math.max(...starts) : undefined;
}

/** The end (ms) of the latest finished feed up to now (an instant feed ends when it starts). */
export function latestFeedEnd(
  events: readonly BabyEvent[],
  types: readonly EventType[],
  now: Date,
): number | undefined {
  const ids = typeIdsForKey(types, FEEDING_KEY);
  const ends = pastLiveEvents(events, now)
    .filter((event) => ids.has(event.typeId) && event.endedAt !== null)
    .map((event) => Date.parse(event.endedAt as string))
    .filter((end) => end <= now.getTime());
  return ends.length ? Math.max(...ends) : undefined;
}

const latestOf = (...values: (number | undefined)[]) => {
  const known = values.filter((value): value is number => value !== undefined);
  return known.length ? Math.max(...known) : undefined;
};

const parsed = (value: string | null | undefined) =>
  value && isInstant(value) ? Date.parse(value) : undefined;

function windowFrom(anchor: number, lower: number, median: number, upper: number): DiaperWindow {
  return {
    anchor: new Date(anchor),
    earliest: new Date(anchor + lower * MINUTE_MS),
    expected: new Date(anchor + median * MINUTE_MS),
    latest: new Date(anchor + upper * MINUTE_MS),
  };
}

/** The suggestion when now is from the lead before the expected time until the grace after it. */
function dueSuggestion(
  candidate: DiaperEstimate,
  input: DiaperSuggestionInput,
): DiaperSuggestion | null {
  const { rule } = candidate.diaper;
  const expected = candidate.window.expected.getTime();
  const now = input.now.getTime();
  const showing = now >= expected - ruleMinutes(rule.leadMinutes, DEFAULT_LEAD_MINUTES) * MINUTE_MS;
  const over = now >= expected + ruleMinutes(rule.graceMinutes, DEFAULT_GRACE_MINUTES) * MINUTE_MS;
  const anchorAt = candidate.window.anchor.toISOString();
  if (!showing || over || anchorAt === input.dismissedAnchor) return null;
  return { ...candidate, anchorAt };
}

/** The next diaper of a kind as estimated now, before the card's timing and "Not now". */
export type DiaperEstimate = Omit<DiaperSuggestion, 'anchorAt'>;

/** What the estimates read: the suggestion input without the dismissal. */
export type DiaperEstimateInput = Omit<DiaperSuggestionInput, 'dismissedAnchor'>;

/**
 * The next wet diaper as estimated now (the wet gap anchored at the latest wet diaper, local or
 * server), or `null` without a wet estimate (too few wet diapers). No timing gate: the ring's
 * "next up" layer reads it whenever it is ahead.
 */
export function wetEstimate(input: DiaperEstimateInput): DiaperEstimate | null {
  const diaper = diaperPredictionsOf(input.predictions);
  const gap = diaper?.wet;
  if (!diaper || !gap) return null;
  const anchor = latestOf(parsed(gap.anchorAt), latestDiaper(input, isWetDiaper)) as number;
  const window = windowFrom(anchor, gap.lowerGapMinutes, gap.medianGapMinutes, gap.upperGapMinutes);
  return { kind: 'wet', signal: 'gap', window, diaper };
}

/**
 * The wet diaper card to show now, or `null`: no wet estimate (too few wet diapers), outside the
 * time (from 20 min before the expected wet diaper until 40 min after it), or "Not now" for this
 * anchor. Anchored at the latest wet diaper (local or server), so logging one hides it.
 */
export function wetSuggestion(input: DiaperSuggestionInput): DiaperSuggestion | null {
  const estimate = wetEstimate(input);
  return estimate ? dueSuggestion(estimate, input) : null;
}

/** The dirty diaper expected after the latest feed, when that signal applies now. */
function afterFeedWindow(
  diaper: DiaperPredictionsDto,
  input: DiaperEstimateInput,
  lastDirty: number | undefined,
): DiaperWindow | null {
  const lag = diaper.dirty?.afterFeed;
  const feedEnd = latestOf(
    parsed(lag?.latestFeedEndedAt),
    latestFeedEnd(input.events, input.types, input.now),
  );
  if (!lag || feedEnd === undefined) return null;
  const horizon = ruleMinutes(diaper.rule.feedWindowMinutes, DEFAULT_FEED_WINDOW_MINUTES);
  const recent = input.now.getTime() - feedEnd <= horizon * MINUTE_MS;
  const handled = lastDirty !== undefined && lastDirty >= feedEnd;
  return recent && !handled
    ? windowFrom(feedEnd, lag.lowerLagMinutes, lag.medianLagMinutes, lag.upperLagMinutes)
    : null;
}

/**
 * The next dirty diaper as estimated now, or `null`. After the latest feed (when the lag after
 * feeds passed its gate on the server, the feed ended at most 3 hours ago and no dirty diaper came
 * since) the window is the usual lag after it; otherwise the gaps between dirty diapers, anchored
 * at the latest one. No timing gate (see `wetEstimate`).
 */
export function dirtyEstimate(input: DiaperEstimateInput): DiaperEstimate | null {
  const diaper = diaperPredictionsOf(input.predictions);
  const dirty = diaper?.dirty;
  if (!diaper || !dirty) return null;
  const lastDirty = latestOf(parsed(dirty.lastDirtyAt), latestDiaper(input, isDirtyDiaper));
  const afterFeed = afterFeedWindow(diaper, input, lastDirty);
  if (afterFeed) return { kind: 'dirty', signal: 'afterFeed', window: afterFeed, diaper };
  const gap = dirty.gap;
  if (!gap) return null;
  const anchor = latestOf(parsed(gap.anchorAt), lastDirty) as number;
  const window = windowFrom(anchor, gap.lowerGapMinutes, gap.medianGapMinutes, gap.upperGapMinutes);
  return { kind: 'dirty', signal: 'gap', window, diaper };
}

/**
 * The dirty diaper card to show now, or `null`: the dirty estimate (`dirtyEstimate`) with the same
 * timing and "Not now" as the wet card.
 */
export function dirtySuggestion(input: DiaperSuggestionInput): DiaperSuggestion | null {
  const estimate = dirtyEstimate(input);
  return estimate ? dueSuggestion(estimate, input) : null;
}
