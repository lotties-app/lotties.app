import { describe, expect, it } from 'vitest';
import type { MeasurementDto } from '../sync/contract';
import {
  emptyForm,
  seriesFor,
  sortNewestFirst,
  todayLocal,
  valueAxis,
  validateForm,
  type MeasurementForm,
} from './measurementModel';

const NOW = new Date(2026, 9, 20, 12, 0, 0);
const form = (overrides: Partial<MeasurementForm>): MeasurementForm => ({
  ...emptyForm(NOW),
  ...overrides,
});

function dto(
  id: string,
  date: string,
  weightKg: number | null,
  createdAt = '2026-10-01',
): MeasurementDto {
  return {
    id,
    babyId: 'b',
    date,
    weightKg,
    heightCm: null,
    headCircumferenceCm: null,
    notes: null,
    createdBy: null,
    createdAt,
    updatedAt: createdAt,
  };
}

describe('validateForm', () => {
  it('builds a request, accepting a decimal comma and rounding to 2 decimals', () => {
    const result = validateForm(form({ weightKg: '5,1234', heightCm: ' 60 ', notes: ' hi ' }), NOW);
    expect(result).toEqual({
      ok: true,
      request: {
        date: '2026-10-20',
        weightKg: 5.12,
        heightCm: 60,
        headCircumferenceCm: null,
        notes: 'hi',
      },
    });
  });

  it('requires at least one value', () => {
    const result = validateForm(form({}), NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.values).toMatch(/at least one/);
  });

  it.each([
    ['weightKg', '0.2'],
    ['weightKg', '41'],
    ['heightCm', '19'],
    ['heightCm', '131'],
    ['headCircumferenceCm', '19.9'],
    ['headCircumferenceCm', '61'],
    ['weightKg', 'abc'],
  ] as const)('rejects %s = %s', (key, value) => {
    const result = validateForm(form({ [key]: value }), NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[key]).toBeTruthy();
  });

  it('accepts the boundary values', () => {
    expect(
      validateForm(form({ weightKg: '0.3', heightCm: '130', headCircumferenceCm: '20' }), NOW).ok,
    ).toBe(true);
    expect(
      validateForm(form({ weightKg: '40', heightCm: '20', headCircumferenceCm: '60' }), NOW).ok,
    ).toBe(true);
  });

  it('rejects a future date and a missing date, accepts today', () => {
    const future = validateForm(form({ weightKg: '5', date: '2026-10-21' }), NOW);
    expect(future.ok).toBe(false);
    if (!future.ok) expect(future.errors.date).toMatch(/future/);
    expect(validateForm(form({ weightKg: '5', date: '' }), NOW).ok).toBe(false);
    expect(validateForm(form({ weightKg: '5', date: todayLocal(NOW) }), NOW).ok).toBe(true);
  });
});

describe('series', () => {
  const list = [dto('a', '2026-10-10', 5), dto('b', '2026-09-01', 4), dto('c', '2026-10-05', null)];

  it('orders a metric by date ascending and skips missing values', () => {
    expect(seriesFor(list, 'weightKg')).toEqual([
      { date: '2026-09-01', value: 4 },
      { date: '2026-10-10', value: 5 },
    ]);
    expect(seriesFor(list, 'heightCm')).toEqual([]);
  });

  it('sorts the list newest first', () => {
    expect(sortNewestFirst(list).map((m) => m.id)).toEqual(['a', 'c', 'b']);
  });

  it('gives an axis with headroom, also for a single value', () => {
    const axis = valueAxis([{ date: '2026-10-10', value: 5 }]);
    expect(axis.min).toBeLessThan(5);
    expect(axis.max).toBeGreaterThan(5);
    expect(axis.ticks).toHaveLength(5);
  });
});
