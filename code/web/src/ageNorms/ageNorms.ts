/*
 * The published age norms as served by `GET /api/v1/age-norms` (the API's
 * code/api/data/age-norms.json, schema 1; docs/design/28-age-norms.md). Facts only: a norm seeds or
 * bounds a suggestion until the baby's own log has enough data, and the app never tells a family
 * that a baby is inside or outside a norm. Only a norm `priorFor` returns (not low confidence, not
 * waiting for a review) may replace a default; the others stay documentation. The C# twin is
 * `Lotties.Domain.AgeNorms.AgeNormSet`; both run the shared vectors in ageNormsVectors.json.
 */

/** The schema version this app reads. */
export const SUPPORTED_AGE_NORMS_SCHEMA = 1;

export type AgeNormPopulation = 'all' | 'breastfed' | 'formula';
export type AgeNormConfidence = 'high' | 'medium' | 'low';

/** The metric keys the app reads (the file defines more). */
export const AGE_NORM_METRICS = {
  feedVolumeMlPerFeed: 'feed_volume_ml_per_feed',
  feedsPer24h: 'feeds_per_24h',
  feedGapMinutes: 'feed_gap_minutes',
  longestSleepHours: 'longest_sleep_hours',
  nightSleepHours: 'night_sleep_hours',
} as const;

/** An age band in completed days since birth: `[fromDays, toDays)`. */
export interface AgeNormBand {
  fromDays: number;
  toDays: number;
  fromWeeks: number;
  toWeeks: number;
  label: string;
}

export interface AgeNorm {
  id: string;
  metric: string;
  population: string;
  ageBand: AgeNormBand;
  low: number | null;
  typical: number | null;
  high: number | null;
  unit: string;
  typicalSourceId: string | null;
  sourceIds: string[];
  confidence: string;
  needsReview: boolean;
  needsReviewReason: string | null;
}

export interface AgeNormSource {
  id: string;
  citation: string;
  url: string;
  licence: string;
}

export interface AgeNormSet {
  schemaVersion: number;
  generatedAt: string;
  sources: AgeNormSource[];
  norms: AgeNorm[];
}

/** What a lookup returns: the merged values of one band and how far they can be trusted. */
export interface NormValue {
  id: string;
  low: number | null;
  typical: number | null;
  high: number | null;
  unit: string;
  confidence: AgeNormConfidence;
  needsReview: boolean;
}

/** Whether `value` looks like age norms of the schema this app reads. */
export function isReadableAgeNorms(value: unknown): value is AgeNormSet {
  const norms = value as Partial<AgeNormSet> | null | undefined;
  return (
    typeof norms === 'object' &&
    norms !== null &&
    norms.schemaVersion === SUPPORTED_AGE_NORMS_SCHEMA &&
    Array.isArray(norms.norms) &&
    Array.isArray(norms.sources)
  );
}

const CONFIDENCES: readonly string[] = ['high', 'medium', 'low'];
const numberOrNull = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

function inBand(
  norms: AgeNormSet,
  metric: string,
  population: string,
  ageDays: number,
): AgeNorm | undefined {
  return norms.norms.find(
    (norm) =>
      norm.metric === metric &&
      norm.population === population &&
      norm.ageBand.fromDays <= ageDays &&
      ageDays < norm.ageBand.toDays,
  );
}

/**
 * The norm of `metric` whose band holds `ageDays` (completed days since birth): the one of
 * `population`, else the one of `all`; `null` without norms, for a negative or non-whole age, or
 * when no band holds it. Low-confidence norms and norms that need review are returned too, with
 * their flags: use `priorFor` for a default.
 */
export function normFor(
  norms: AgeNormSet | null | undefined,
  metric: string,
  population: AgeNormPopulation,
  ageDays: number,
): NormValue | null {
  if (!norms || !Number.isInteger(ageDays) || ageDays < 0) return null;
  const norm = inBand(norms, metric, population, ageDays) ?? inBand(norms, metric, 'all', ageDays);
  if (!norm) return null;
  return {
    id: norm.id,
    low: numberOrNull(norm.low),
    typical: numberOrNull(norm.typical),
    high: numberOrNull(norm.high),
    unit: norm.unit,
    confidence: (CONFIDENCES.includes(norm.confidence)
      ? norm.confidence
      : 'low') as AgeNormConfidence,
    needsReview: norm.needsReview !== false,
  };
}

/**
 * `normFor` when that norm may replace a default, else `null`: a low-confidence norm or one that
 * needs review is never used as a prior; the caller keeps its own default.
 */
export function priorFor(
  norms: AgeNormSet | null | undefined,
  metric: string,
  population: AgeNormPopulation,
  ageDays: number,
): NormValue | null {
  const norm = normFor(norms, metric, population, ageDays);
  return norm && !norm.needsReview && norm.confidence !== 'low' ? norm : null;
}

const BIRTH_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

/**
 * Completed days from `birthDate` (`yyyy-mm-dd`) to the local calendar date of `at` (birth day =
 * 0); `null` when the date is missing, malformed or after `at`.
 */
export function ageInDaysAt(birthDate: string | null | undefined, at: Date): number | null {
  const match = birthDate ? BIRTH_DATE.exec(birthDate) : null;
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]) - 1, Number(match[3])];
  const check = new Date(year, month, day);
  if (check.getFullYear() !== year || check.getMonth() !== month || check.getDate() !== day) {
    return null;
  }
  const days = Math.round(
    (Date.UTC(at.getFullYear(), at.getMonth(), at.getDate()) - Date.UTC(year, month, day)) / DAY_MS,
  );
  return days >= 0 ? days : null;
}
