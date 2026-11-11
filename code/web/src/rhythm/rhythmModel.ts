import type { TFunction } from 'i18next';
import { formatDuration, formatNumber, formatTime } from '../i18n/format';
import type {
  ClockMetric,
  CountRange,
  MinutesRange,
  Rhythm,
  RhythmAssociation,
  RhythmOutcome,
  RhythmRule,
} from './rhythmApi';

/*
 * Pure helpers of the rhythm section (docs/design/48-baby-rhythm.md): what is missing for a metric
 * that is not ready (from the rule constants of the answer, never a guess), clock and range texts
 * through the Intl helpers, and the descriptive sentences of the associations whose outcome passed
 * the rule. The wording never says why two groups of nights differ.
 */

const MINUTE_MS = 60_000;

/** How many more of something a metric needs (at least 1 while it is not ready). */
export function needsMore(have: number, minimum: number): number {
  return Math.max(1, Math.ceil(minimum - have));
}

export type MissingUnit = 'nights' | 'days' | 'gaps';
export interface Missing {
  unit: MissingUnit;
  count: number;
}

/** `null`: the metric is ready, or nothing honest can be said about what it lacks. */
export function missingForClock(metric: ClockMetric, rule: RhythmRule): Missing | null {
  if (metric.status !== 'not_enough_data') return null;
  return { unit: 'nights', count: needsMore(metric.nights, rule.minimumNights) };
}

export function missingForNights(metric: MinutesRange, rule: RhythmRule): Missing | null {
  if (metric.status !== 'not_enough_data') return null;
  return { unit: 'nights', count: needsMore(metric.count, rule.minimumNights) };
}

/**
 * Naps per day count the days between two counted nights. With enough such days and still no
 * value, the missing part is a nap in them (`noNaps`), not more days.
 */
export function missingForNaps(metric: CountRange, rule: RhythmRule): Missing | 'noNaps' | null {
  if (metric.status !== 'not_enough_data') return null;
  if (metric.count >= rule.minimumDays) return 'noNaps';
  return { unit: 'days', count: needsMore(metric.count, rule.minimumDays) };
}

export function missingForFeeds(metric: CountRange, rule: RhythmRule): Missing | null {
  if (metric.status !== 'not_enough_data') return null;
  return { unit: 'days', count: needsMore(metric.count, rule.minimumDays) };
}

export function missingForGap(metric: MinutesRange, rule: RhythmRule): Missing | null {
  if (metric.status !== 'not_enough_data') return null;
  return { unit: 'gaps', count: needsMore(metric.count, rule.minimumFeedGaps) };
}

export function missingText(t: TFunction, missing: Missing): string {
  switch (missing.unit) {
    case 'nights':
      return t('rhythm.needs.nights', { count: missing.count });
    case 'days':
      return t('rhythm.needs.days', { count: missing.count });
    case 'gaps':
      return t('rhythm.needs.gaps', { count: missing.count });
  }
}

/** A local `HH:mm` of the answer in the viewer's locale (24-hour, like every clock in the app). */
export function formatClock(clock: string): string {
  const [h, m] = clock.split(':').map(Number);
  return formatTime(new Date(2000, 0, 1, h, m));
}

export const minutesText = (minutes: number) => formatDuration(minutes * MINUTE_MS);

const countText = (value: number) => formatNumber(value, { maximumFractionDigits: 1 });

/** `around 19:45`. */
export const aroundText = (t: TFunction, clock: string) =>
  t('rhythm.around', { time: formatClock(clock) });

export interface RangeText {
  /** `10 h to 10 h 45 min`, or one value when the middle half is a single value. */
  range: string;
  median: string;
}

function rangeOf(
  range: { p25: number; median: number; p75: number },
  format: (value: number) => string,
  t: TFunction,
): RangeText {
  const low = format(range.p25);
  const high = format(range.p75);
  return {
    range: low === high ? low : t('rhythm.range', { low, high }),
    median: t('rhythm.median', { value: format(range.median) }),
  };
}

export function minutesRangeText(t: TFunction, metric: MinutesRange): RangeText | null {
  return metric.status === 'ok' && metric.range ? rangeOf(metric.range, minutesText, t) : null;
}

export function countRangeText(t: TFunction, metric: CountRange): RangeText | null {
  return metric.status === 'ok' && metric.range ? rangeOf(metric.range, countText, t) : null;
}

/** `Times spread by about 1 h 40 min over 12 nights`. */
export function variesText(t: TFunction, metric: ClockMetric): string {
  return metric.spreadMinutes === null
    ? t('rhythm.variesNoSpread', { count: metric.nights })
    : t('rhythm.variesDetail', { count: metric.nights, spread: minutesText(metric.spreadMinutes) });
}

/* Associations (section 4). */

const subjectOf = (t: TFunction, association: RhythmAssociation) =>
  association.factor === 'evening_feeds'
    ? t('rhythm.log.subject.evening_feeds', { count: association.threshold ?? 1 })
    : t('rhythm.log.subject.dirty_diaper_day');

function predicateOf(t: TFunction, outcome: RhythmOutcome, difference: string): string {
  const longer = (outcome.differenceMinutes ?? 0) > 0;
  switch (outcome.outcome) {
    case 'night_length':
      return longer
        ? t('rhythm.log.predicate.night_length_longer', { difference })
        : t('rhythm.log.predicate.night_length_shorter', { difference });
    case 'longest_stretch':
      return longer
        ? t('rhythm.log.predicate.longest_stretch_longer', { difference })
        : t('rhythm.log.predicate.longest_stretch_shorter', { difference });
    case 'first_stretch':
      return longer
        ? t('rhythm.log.predicate.first_stretch_longer', { difference })
        : t('rhythm.log.predicate.first_stretch_shorter', { difference });
  }
}

/**
 * One descriptive sentence per outcome that passed the rule, in the order of the answer:
 * "After days with 2 or more evening feeds, nights were usually about 40 min longer (12 nights,
 * against 10 without)."
 */
export function associationSentences(t: TFunction, rhythm: Rhythm): string[] {
  return rhythm.associations.flatMap((association) =>
    association.outcomes
      .filter((o) => o.status === 'ok' && o.differenceMinutes !== null && o.differenceMinutes !== 0)
      .map((outcome) =>
        t('rhythm.log.sentence', {
          subject: subjectOf(t, association),
          predicate: predicateOf(t, outcome, minutesText(Math.abs(outcome.differenceMinutes!))),
          with: t('rhythm.log.nights', { count: outcome.nightsWith }),
          without: outcome.nightsWithout,
        }),
      ),
  );
}

/**
 * When no sentence passed: `noClearDifference` if some comparison had enough nights on both sides
 * (saying "not enough nights" then would be untrue), else `notEnough`.
 */
export function comparisonState(rhythm: Rhythm): 'sentences' | 'noClearDifference' | 'notEnough' {
  const outcomes = rhythm.associations.flatMap((a) => a.outcomes);
  if (outcomes.some((o) => o.status === 'ok' && o.differenceMinutes)) return 'sentences';
  if (outcomes.some((o) => o.status === 'no_clear_difference')) return 'noClearDifference';
  return 'notEnough';
}

/** The nights of each side of a factor so far (the largest over its outcomes). */
export function factorCounts(association: RhythmAssociation): { with: number; without: number } {
  return association.outcomes.reduce(
    (acc, o) => ({
      with: Math.max(acc.with, o.nightsWith),
      without: Math.max(acc.without, o.nightsWithout),
    }),
    { with: 0, without: 0 },
  );
}

/** The plain-words list of the rule values ("How this is worked out"). */
export function ruleLines(t: TFunction, rule: RhythmRule): string[] {
  return [
    t('rhythm.how.window', { count: rule.lookBackDays }),
    t('rhythm.how.evening', { time: formatClock(rule.eveningDayStartsAt) }),
    t('rhythm.how.nightBounds', {
      min: minutesText(rule.minimumNightMinutes),
      max: minutesText(rule.maximumNightMinutes),
    }),
    t('rhythm.how.minimumNights', { count: rule.minimumNights }),
    t('rhythm.how.minimumDays', { count: rule.minimumDays }),
    t('rhythm.how.minimumGaps', {
      count: rule.minimumFeedGaps,
      max: minutesText(rule.maximumFeedGapMinutes),
    }),
    t('rhythm.how.varies', { spread: minutesText(rule.maximumClockSpreadMinutes) }),
    t('rhythm.how.ranges'),
    t('rhythm.how.eveningFeeds', { window: minutesText(rule.eveningFeedWindowMinutes) }),
    t('rhythm.how.groups', {
      count: rule.minimumGroupNights,
      difference: minutesText(rule.minimumDifferenceMinutes),
    }),
    t('rhythm.how.describes'),
  ];
}
