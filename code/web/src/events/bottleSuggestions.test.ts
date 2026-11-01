import { describe, expect, it } from 'vitest';
import type { BabyEvent } from '../db/models';
import {
  ageInMonths,
  ageRangeFor,
  BOTTLE_AGE_RANGES,
  NEUTRAL_BOTTLE_AMOUNTS,
  rangeChips,
} from './bottleAgeDefaults';
import {
  BOTTLE_STEP_ML,
  bottleSuggestions,
  frequentAmounts,
  MAX_CHIPS,
  median,
  recentBottleAmounts,
  roundToStep,
} from './bottleSuggestions';

const NOW = new Date(2026, 9, 21, 14, 0);
const FEEDING = 'type-feeding';
let n = 0;

/** A bottle `hoursAgo` before NOW. */
function bottle(amount: unknown, hoursAgo: number, extra: Partial<BabyEvent> = {}): BabyEvent {
  n += 1;
  const at = new Date(NOW.getTime() - hoursAgo * 3_600_000).toISOString();
  return {
    id: `e${n}`,
    babyId: 'b1',
    typeId: FEEDING,
    startedAt: at,
    endedAt: at,
    payload: { method: 'bottle', amount_ml: amount },
    notes: null,
    createdAt: at,
    updatedAt: at,
    deletedAt: null,
    ...extra,
  } as BabyEvent;
}

/** Bottles of these amounts, newest first, 3 h apart. */
const history = (...amounts: number[]) => amounts.map((ml, i) => bottle(ml, 3 * (i + 1)));

const suggest = (
  events: BabyEvent[],
  more: Partial<Parameters<typeof bottleSuggestions>[0]> = {},
) => bottleSuggestions({ events, feedingTypeId: FEEDING, now: NOW, birthDate: null, ...more });

describe('helpers', () => {
  it('median of odd and even counts, none for empty', () => {
    expect(median([120, 90, 150])).toBe(120);
    expect(median([90, 120, 150, 160])).toBe(135);
    expect(median([])).toBeNull();
  });

  it('rounds to the 10 ml step', () => {
    expect(BOTTLE_STEP_ML).toBe(10);
    expect(roundToStep(124)).toBe(120);
    expect(roundToStep(125)).toBe(130);
    expect(roundToStep(97)).toBe(100);
  });

  it('frequent amounts: rounded, most frequent first, ties to the most recent, up to 3', () => {
    expect(frequentAmounts([118, 122, 150, 90, 152, 60, 80])).toEqual([120, 150, 90]);
    expect(frequentAmounts([100, 110, 120, 130])).toEqual([100, 110, 120]);
  });
});

describe('recentBottleAmounts', () => {
  it('keeps live bottles with a positive amount of the last 30 days, newest first, up to 20', () => {
    const events = [
      bottle(120, 2),
      bottle(0, 3),
      bottle('90', 4),
      bottle(150, 5, { deletedAt: NOW.toISOString() }),
      bottle(130, 31 * 24),
      bottle(100, -1),
      bottle(110, 6, { typeId: 'other' }),
      { ...bottle(140, 7), payload: { method: 'breast', amount_ml: 140 } },
      bottle(90, 8),
    ];
    expect(recentBottleAmounts(events, NOW, FEEDING)).toEqual([120, 90]);
    const many = Array.from({ length: 25 }, (_, i) => bottle(100 + i, i + 1));
    expect(recentBottleAmounts(many, NOW)).toHaveLength(20);
    expect(recentBottleAmounts(many, NOW)[0]).toBe(100);
  });
});

describe('bottleSuggestions from history', () => {
  it('typical (median of the last 7), its top-up pair and the frequent amounts', () => {
    const s = suggest(history(120, 120, 122, 118, 120, 60, 120, 200, 200));
    expect(s.source).toBe('history');
    expect(s.preferred).toBe(120);
    expect(s.step).toBe(10);
    // 120 typical, 150 / 180 topped up, frequent 120, 200 (older, not in the last 7), 60.
    expect(s.amounts).toEqual([60, 120, 150, 180, 200]);
  });

  it('the owner: 120 ml, sometimes 60 more', () => {
    expect(suggest(history(120, 180, 120, 120)).amounts).toEqual([120, 150, 180]);
  });

  it('sorts ascending, dedupes and caps at 5', () => {
    const s = suggest(history(100, 70, 130, 100, 70, 130, 40));
    expect(s.amounts.length).toBeLessThanOrEqual(MAX_CHIPS);
    expect(new Set(s.amounts).size).toBe(s.amounts.length);
    expect([...s.amounts].sort((a, b) => a - b)).toEqual(s.amounts);
    // typical 100, top-ups 130 / 160, frequent 100, 70, 130.
    expect(s.amounts).toEqual([70, 100, 130, 160]);
  });

  it('never zero, and inside the field range', () => {
    const s = suggest(history(10, 10, 10), { min: 20, max: 60 });
    expect(s.amounts).toEqual([40]);
    expect(s.amounts.every((a) => a > 0)).toBe(true);
  });

  it('the included amount always comes first (kept as is)', () => {
    const s = suggest(history(120, 120, 120, 90, 60), { include: 135 });
    expect(s.amounts).toContain(135);
    expect(s.amounts).toHaveLength(5);
  });

  it('ignores soft-deleted bottles (2 live ones is a cold start)', () => {
    const events = [...history(120, 120), bottle(120, 1, { deletedAt: NOW.toISOString() })];
    expect(suggest(events).source).toBe('neutral');
  });
});

describe('cold start', () => {
  it('fewer than 3 bottles and no birth date: the neutral set, nothing about age', () => {
    const s = suggest(history(120, 120));
    expect(s).toMatchObject({ source: 'neutral', ageMonths: null, preferred: 120 });
    expect(s.amounts).toEqual([...NEUTRAL_BOTTLE_AMOUNTS]);
  });

  it('a malformed or future birth date is like none', () => {
    expect(ageInMonths('', NOW)).toBeNull();
    expect(ageInMonths('2026-13-01', NOW)).toBeNull();
    expect(ageInMonths('2026-02-30', NOW)).toBeNull();
    expect(ageInMonths('2026-10-22', NOW)).toBeNull();
    expect(suggest([], { birthDate: '2026-11-01' }).source).toBe('neutral');
  });

  it.each([
    ['2026-10-21', 0, [30, 60, 90]],
    ['2026-09-22', 0, [30, 60, 90]],
    ['2026-09-21', 1, [90, 120]],
    ['2026-08-21', 2, [120, 150]],
    ['2026-07-21', 3, [120, 150, 180]],
    ['2026-06-22', 3, [120, 150, 180]],
    ['2026-06-21', 4, [160, 190]],
    ['2026-05-21', 5, [180, 210, 240]],
    ['2026-04-21', 6, [180, 210, 240]],
    ['2026-03-21', 7, [180, 210, 240]],
    ['2025-01-01', 21, [180, 210, 240]],
  ])('born %s: %i months, chips %j', (birthDate, months, chips) => {
    expect(ageInMonths(birthDate, NOW)).toBe(months);
    const s = suggest([], { birthDate });
    expect(s).toMatchObject({ source: 'age', ageMonths: months });
    expect(s.amounts).toEqual(chips);
  });

  it('age chips are 30 ml steps inside each range; the top is kept when not too close', () => {
    expect(rangeChips({ minMl: 30, maxMl: 90 })).toEqual([30, 60, 90]);
    expect(rangeChips({ minMl: 160, maxMl: 200 })).toEqual([160, 190]);
    expect(rangeChips({ minMl: 100, maxMl: 150 })).toEqual([100, 130, 150]);
    for (const row of BOTTLE_AGE_RANGES) {
      for (const chip of rangeChips(row)) {
        expect(chip).toBeGreaterThanOrEqual(row.minMl);
        expect(chip).toBeLessThanOrEqual(row.maxMl);
      }
    }
    expect(ageRangeFor(99)).toBe(BOTTLE_AGE_RANGES[BOTTLE_AGE_RANGES.length - 1]);
  });

  it('cold start keeps the included amount', () => {
    expect(suggest([], { birthDate: '2026-07-21', include: 100 }).amounts).toEqual([
      100, 120, 150, 180,
    ]);
  });
});
