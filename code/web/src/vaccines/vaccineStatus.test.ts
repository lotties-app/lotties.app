import { describe, expect, it } from 'vitest';
import type { ScheduledDose, VaccineSchedule } from './vaccineSchedule';
import { addDays, ageInDays, calculateVaccineStatus, type VaccineProfile } from './vaccineStatus';
import vectors from './vaccineStatusVectors.json';

/*
 * The shared vectors (vaccineStatusVectors.json) are also read by the API's
 * VaccineStatusVectorTests: the same inputs must give the same dose states and dates on both sides.
 * A vector lists only the dose fields that matter; the rest take the defaults the file documents.
 */

type VectorDose = Partial<ScheduledDose> & { doseId: string; recommendedAgeDays: number };

interface Vector {
  name: string;
  birthDate: string;
  today: string;
  profile: VaccineProfile;
  schedule: VectorDose[];
  records: { id: string; doseId: string | null; givenOn: string }[];
  expected: {
    ageDays: number | null;
    prematureNotice: boolean;
    doses: ({ doseId: string } & Record<string, string | boolean | null>)[];
  };
}

function withDefaults(dose: VectorDose): ScheduledDose {
  const isPrivate = dose.network === 'private';
  return {
    vaccineKey: 'v',
    label: { en: dose.doseId, 'pt-BR': dose.doseId },
    earliestAgeDays: dose.recommendedAgeDays,
    latestAgeDays: null,
    minIntervalDaysFromPrevious: null,
    sources: [isPrivate ? 'sbp' : 'pni'],
    network: 'public',
    notes: { en: dose.doseId, 'pt-BR': dose.doseId },
    alternativeGroup: null,
    needsReview: false,
    needsReviewReason: null,
    previousDoseIds: [],
    covers: [],
    recurrence: null,
    condition: null,
    recordOnly: false,
    ...dose,
  };
}

function scheduleOf(doses: VectorDose[]): VaccineSchedule {
  return {
    schemaVersion: 2,
    profile: 'TEST',
    generatedOn: '2026-10-22',
    sources: [],
    vaccines: [],
    doses: doses.map(withDefaults),
  };
}

describe('calculateVaccineStatus (shared vectors)', () => {
  for (const vector of (vectors as { vectors: Vector[] }).vectors) {
    it(vector.name, () => {
      const result = calculateVaccineStatus({
        schedule: scheduleOf(vector.schedule),
        profile: vector.profile,
        birthDate: vector.birthDate,
        records: vector.records,
        today: vector.today,
      });

      expect(result.prematureNotice).toBe(vector.expected.prematureNotice);
      if (vector.expected.ageDays !== null) expect(result.ageDays).toBe(vector.expected.ageDays);
      for (const expected of vector.expected.doses) {
        const actual = result.doses.find((dose) => dose.doseId === expected.doseId);
        expect(actual, expected.doseId).toBeDefined();
        const compared = Object.fromEntries(
          Object.keys(expected).map((key) => [key, actual?.[key as keyof typeof actual]]),
        );
        expect(compared, expected.doseId).toEqual(expected);
      }
    });
  }
});

describe('date helpers', () => {
  it('count calendar days across a leap day and daylight saving changes', () => {
    expect(addDays('2024-02-29', 365)).toBe('2025-02-28');
    expect(addDays('2026-03-07', 61)).toBe('2026-05-07');
    expect(addDays('2026-10-24', 2)).toBe('2026-10-26');
    expect(ageInDays('2026-10-31', '2026-11-02')).toBe(2);
    expect(ageInDays('2024-02-29', '2028-02-29')).toBe(1461);
  });
});
