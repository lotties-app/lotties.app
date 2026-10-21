import { describe, expect, it } from 'vitest';
import { formatAge } from './formatAge';

const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h);

describe('formatAge', () => {
  it.each([
    ['2026-10-21', at(2026, 10, 21), '0 days'],
    ['2026-10-20', at(2026, 10, 21), '1 day'],
    ['2026-10-10', at(2026, 10, 21), '11 days'],
    ['2026-10-08', at(2026, 10, 21), '13 days'],
    ['2026-10-07', at(2026, 10, 21), '2 weeks'],
    ['2026-09-16', at(2026, 10, 21), '5 weeks'],
    ['2026-08-27', at(2026, 10, 21), '7 weeks'],
    ['2026-08-26', at(2026, 10, 21), '1 month, 3 weeks'],
    ['2026-08-21', at(2026, 10, 21), '2 months'],
    ['2026-08-01', at(2026, 10, 21), '2 months, 2 weeks'],
    ['2026-07-30', at(2026, 10, 21), '2 months, 3 weeks'],
    ['2025-11-22', at(2026, 10, 21), '10 months, 4 weeks'],
    ['2025-10-21', at(2026, 10, 21), '1 year'],
    ['2025-08-21', at(2026, 10, 21), '1 year, 2 months'],
    ['2024-10-21', at(2026, 10, 21), '2 years'],
    ['2024-09-21', at(2026, 10, 21), '2 years, 1 month'],
  ])('%s on %s reads %s', (birth, now, expected) => {
    expect(formatAge(birth, now)).toBe(expected);
  });

  it('clamps month ends (born on the 31st)', () => {
    expect(formatAge('2026-05-31', at(2026, 7, 31))).toBe('2 months');
    expect(formatAge('2026-05-31', at(2026, 7, 30))).toBe('1 month, 4 weeks');
  });

  it('ignores the time of day and DST shifts', () => {
    expect(formatAge('2026-03-01', at(2026, 3, 15, 0))).toBe('2 weeks');
    expect(formatAge('2026-03-01', at(2026, 3, 14, 23))).toBe('13 days');
  });

  it('never goes negative for future or invalid dates', () => {
    expect(formatAge('2026-12-01', at(2026, 10, 21))).toBe('0 days');
    expect(formatAge('not a date', at(2026, 10, 21))).toBe('0 days');
  });
});
