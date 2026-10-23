import { describe, expect, it } from 'vitest';
import { SHIPPED_AGE_NORMS } from '../test/ageNorms';
import {
  ageInDaysAt,
  isReadableAgeNorms,
  normFor,
  priorFor,
  type AgeNormPopulation,
  type AgeNormSet,
} from './ageNorms';
import vectors from './ageNormsVectors.json';

/*
 * The age norms lookup against the shipped file (docs/design/28-age-norms.md). The shared vectors
 * (ageNormsVectors.json) are also run by the API's Lotties.Domain.Tests (AgeNormsVectorTests), so
 * both engines find the same norm with the same prior decision.
 */

describe('the shared age norms vectors', () => {
  it.each(vectors.lookups.map((vector) => [vector.name, vector] as const))('%s', (_, vector) => {
    const population = vector.population as AgeNormPopulation;
    const norm = normFor(SHIPPED_AGE_NORMS, vector.metric, population, vector.ageDays);
    const prior = priorFor(SHIPPED_AGE_NORMS, vector.metric, population, vector.ageDays);

    expect(prior !== null).toBe(vector.prior);
    if (vector.expected === null) {
      expect(norm).toBeNull();
      return;
    }
    expect(norm).toMatchObject(vector.expected);
  });
});

describe('normFor and priorFor', () => {
  it('reads nothing without norms or for an age that is not a whole number of days', () => {
    expect(normFor(null, 'total_sleep_hours_24h', 'all', 100)).toBeNull();
    expect(normFor(undefined, 'total_sleep_hours_24h', 'all', 100)).toBeNull();
    expect(normFor(SHIPPED_AGE_NORMS, 'total_sleep_hours_24h', 'all', 100.5)).toBeNull();
    expect(priorFor(SHIPPED_AGE_NORMS, 'total_sleep_hours_24h', 'all', Number.NaN)).toBeNull();
  });

  it('never returns a low-confidence norm or one that needs review as a prior', () => {
    for (const norm of SHIPPED_AGE_NORMS.norms) {
      const population = norm.population as AgeNormPopulation;
      const prior = priorFor(SHIPPED_AGE_NORMS, norm.metric, population, norm.ageBand.fromDays);
      expect(prior?.id ?? null).toBe(
        norm.confidence === 'low' || norm.needsReview ? null : norm.id,
      );
    }
  });

  it('treats an unknown confidence as low and a missing review flag as needing review', () => {
    const odd = {
      ...SHIPPED_AGE_NORMS,
      norms: [
        { ...SHIPPED_AGE_NORMS.norms[0], confidence: 'certain' },
        { ...SHIPPED_AGE_NORMS.norms[1], needsReview: undefined },
      ],
    } as unknown as AgeNormSet;
    const [first, second] = odd.norms;
    expect(normFor(odd, first.metric, 'all', first.ageBand.fromDays)?.confidence).toBe('low');
    expect(priorFor(odd, first.metric, 'all', first.ageBand.fromDays)).toBeNull();
    expect(priorFor(odd, second.metric, 'all', second.ageBand.fromDays)).toBeNull();
  });
});

describe('isReadableAgeNorms', () => {
  it('accepts the shipped file and refuses other shapes', () => {
    expect(isReadableAgeNorms(SHIPPED_AGE_NORMS)).toBe(true);
    expect(isReadableAgeNorms({ ...SHIPPED_AGE_NORMS, schemaVersion: 2 })).toBe(false);
    expect(isReadableAgeNorms([])).toBe(false);
    expect(isReadableAgeNorms(null)).toBe(false);
    expect(isReadableAgeNorms({ schemaVersion: 1 })).toBe(false);
  });
});

describe('ageInDaysAt', () => {
  const at = (iso: string) => new Date(iso);

  it('counts local calendar days from the birth date (birth day = 0)', () => {
    expect(ageInDaysAt('2026-10-20', at('2026-10-20T23:00:00'))).toBe(0);
    expect(ageInDaysAt('2026-10-20', at('2026-10-21T00:10:00'))).toBe(1);
    expect(ageInDaysAt('2026-01-01', at('2026-12-31T12:00:00'))).toBe(364);
    expect(ageInDaysAt('2024-02-28', at('2024-03-01T08:00:00'))).toBe(2);
  });

  it('is null for a missing, malformed, impossible or future date', () => {
    expect(ageInDaysAt(null, at('2026-10-20T12:00:00'))).toBeNull();
    expect(ageInDaysAt('20-10-2026', at('2026-10-20T12:00:00'))).toBeNull();
    expect(ageInDaysAt('2026-02-30', at('2026-10-20T12:00:00'))).toBeNull();
    expect(ageInDaysAt('2026-10-21', at('2026-10-20T12:00:00'))).toBeNull();
  });
});
