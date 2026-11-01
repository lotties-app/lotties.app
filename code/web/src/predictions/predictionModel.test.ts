import { describe, expect, it } from 'vitest';
import type { PredictionDto } from '../sync/contract';
import { EVENT_TYPES } from '../test/seed';
import {
  clockWithDay,
  describeDuration,
  describeWindow,
  isOverdue,
  typeForKey,
  typeNameForKey,
} from './predictionModel';
import { utcOffsetMinutes } from './usePredictions';

const local = (day: number, h: number, m = 0) => new Date(2026, 9, day, h, m).toISOString();
const NOW = new Date(2026, 9, 20, 13, 0);

function prediction(overrides: Partial<PredictionDto> = {}): PredictionDto {
  return {
    typeKey: 'feeding',
    nextStart: {
      earliest: local(20, 14, 5),
      expected: local(20, 14, 20),
      latest: local(20, 14, 40),
    },
    expectedDuration: { minutes: 25, sampleCount: 9 },
    confidence: 'High',
    sampleCount: 12,
    reason: 'Median gap 3 h over 14 days.',
    basis: {},
    ...overrides,
  };
}

describe('predictionModel', () => {
  it('describes the expected window in local time', () => {
    expect(describeWindow(prediction(), NOW)).toBe('around 14:20, between 14:05 and 14:40');
  });

  it('adds a day hint outside today', () => {
    expect(clockWithDay(local(21, 2, 10), NOW)).toBe('tomorrow 02:10');
    expect(clockWithDay(local(19, 23, 50), NOW)).toBe('yesterday 23:50');
    expect(clockWithDay(local(23, 8), NOW)).toBe('2026-10-23 08:00');
  });

  it('is overdue once the expected start has passed', () => {
    expect(isOverdue(prediction(), NOW)).toBe(false);
    expect(isOverdue(prediction(), new Date(2026, 9, 20, 14, 21))).toBe(true);
  });

  it('describes the typical duration when known', () => {
    expect(describeDuration(prediction())).toBe('usually lasts 25m');
    expect(describeDuration(prediction({ expectedDuration: null }))).toBeNull();
  });

  it("prefers the baby's own type for a key and falls back to the key", () => {
    const custom = { ...EVENT_TYPES[0], id: 'custom', babyId: 'baby-1', name: 'My feeding' };
    expect(typeForKey([...EVENT_TYPES, custom], 'feeding', 'baby-1')?.id).toBe('custom');
    expect(typeNameForKey(EVENT_TYPES, 'tummy_time', 'baby-1')).toBe('tummy time');
  });

  it('sends the UTC offset as minutes east of UTC', () => {
    const date = new Date(2026, 9, 20);
    // `0 - x`, not `-x`: in a UTC zone the offset is +0, and `-0` would fail toBe (Object.is).
    expect(utcOffsetMinutes(date)).toBe(0 - date.getTimezoneOffset());
    expect(Object.is(utcOffsetMinutes({ getTimezoneOffset: () => 0 } as Date), 0)).toBe(true);
  });
});
