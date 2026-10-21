import { describe, expect, it } from 'vitest';
import { firstWeekday, jumpWeek, weekDays, weekStart } from './weekModel';

const d = (month: number, day: number) => new Date(2026, month - 1, day, 15);

describe('weekStart and weekDays', () => {
  it('starts on Sunday or Monday as asked (21 Oct 2026 is a Wednesday)', () => {
    expect(weekStart(d(10, 21), 7)).toEqual(new Date(2026, 9, 18));
    expect(weekStart(d(10, 21), 1)).toEqual(new Date(2026, 9, 19));
    expect(weekStart(d(10, 18), 7)).toEqual(new Date(2026, 9, 18));
    expect(weekStart(d(10, 18), 1)).toEqual(new Date(2026, 9, 12));
  });

  it('lists seven consecutive local days across a month end', () => {
    const days = weekDays(d(10, 29), 7);
    expect(days.map((day) => day.getDate())).toEqual([25, 26, 27, 28, 29, 30, 31]);
    const next = weekDays(d(11, 2), 7);
    expect(next[0]).toEqual(new Date(2026, 10, 1));
  });

  it('stays at midnight through a daylight saving change', () => {
    for (const day of weekDays(new Date(2026, 2, 8, 12), 7)) expect(day.getHours()).toBe(0);
  });
});

describe('jumpWeek', () => {
  it('moves a week back and forward, and never past today', () => {
    expect(jumpWeek(d(10, 21), -1, d(10, 21))).toEqual(new Date(2026, 9, 14));
    expect(jumpWeek(d(10, 7), 1, d(10, 21))).toEqual(new Date(2026, 9, 14));
    expect(jumpWeek(d(10, 18), 1, d(10, 21))).toEqual(new Date(2026, 9, 21));
  });
});

describe('firstWeekday', () => {
  it('returns a weekday number, with Monday as the fallback', () => {
    expect(firstWeekday('en-US')).toBeGreaterThanOrEqual(1);
    expect(firstWeekday('en-US')).toBeLessThanOrEqual(7);
    expect(firstWeekday('not a locale')).toBe(1);
  });
});
