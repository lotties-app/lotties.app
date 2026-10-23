import { ageInDaysAt, AGE_NORM_METRICS, priorFor, type AgeNormSet } from '../ageNorms/ageNorms';
import { HOUR_MS } from '../now/eventFacts';

/*
 * The longest gap between two feed starts that still counts as a real gap in the feeding average
 * (docs/design/28-age-norms.md section 15.2); a longer one means a feed was probably not logged.
 * 8 hours by default. From 6 months of age, when a published norm usable as a prior covers the
 * age, the published longest sleep period's high end (else the night sleep's), kept between 8 and
 * 14 hours: older babies really do sleep longer than 8 hours without a feed. The C# twin is
 * `Lotties.Domain.Clinical.FeedGapLimit`; both run the shared vectors (ageNormsVectors.json).
 */

/** The cut-off without a usable norm, and always under `FEED_GAP_NORM_FROM_DAYS`. */
export const DEFAULT_FEED_GAP_MS = 8 * HOUR_MS;
/** The safe maximum: above every published night (13.7 h), below the 16 h night-session cap. */
export const FEED_GAP_MAX_MS = 14 * HOUR_MS;
/** The norms apply from this age (6 months): under it the cut-off stays 8 hours. */
export const FEED_GAP_NORM_FROM_DAYS = 183;

/** The cut-off (ms) at `ageDays` completed days; `null` is an unknown age (8 hours). */
export function maxFeedGapMs(norms: AgeNormSet | null | undefined, ageDays: number | null): number {
  if (!norms || ageDays === null || ageDays < FEED_GAP_NORM_FROM_DAYS) return DEFAULT_FEED_GAP_MS;
  const high =
    priorFor(norms, AGE_NORM_METRICS.longestSleepHours, 'all', ageDays)?.high ??
    priorFor(norms, AGE_NORM_METRICS.nightSleepHours, 'all', ageDays)?.high ??
    null;
  if (high === null) return DEFAULT_FEED_GAP_MS;
  return Math.min(FEED_GAP_MAX_MS, Math.max(DEFAULT_FEED_GAP_MS, high * HOUR_MS));
}

/** What the age-aware cut-off reads: the baby's birth date and the norms on the device. */
export interface FeedGapContext {
  birthDate: string | null | undefined;
  ageNorms: AgeNormSet | null | undefined;
}

/**
 * The cut-off for a gap that starts at `startMs`, by the baby's age on the local date of that
 * start; 8 hours without a context.
 */
export function feedGapLimitAt(context: FeedGapContext | undefined): (startMs: number) => number {
  if (!context?.ageNorms || !context.birthDate) return () => DEFAULT_FEED_GAP_MS;
  const { ageNorms, birthDate } = context;
  return (startMs) => maxFeedGapMs(ageNorms, ageInDaysAt(birthDate, new Date(startMs)));
}
