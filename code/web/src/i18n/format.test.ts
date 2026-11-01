import { describe, expect, it } from 'vitest';
import { activateLocale } from './i18n';
import {
  formatAge,
  formatDate,
  formatDuration,
  formatList,
  formatNumber,
  formatRelative,
  formatTime,
  formatUnit,
} from './format';

const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h);
const MINUTE = 60_000;

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

  it('uses the Portuguese plurals and joiner', async () => {
    await activateLocale('pt-BR');
    expect(formatAge('2026-10-20', at(2026, 10, 21))).toBe('1 dia');
    expect(formatAge('2026-10-10', at(2026, 10, 21))).toBe('11 dias');
    expect(formatAge('2026-07-30', at(2026, 10, 21))).toBe('2 meses e 3 semanas');
    expect(formatAge('2025-08-21', at(2026, 10, 21))).toBe('1 ano e 2 meses');
  });
});

describe('formatDuration', () => {
  it('rounds to whole minutes and drops empty parts', () => {
    expect(formatDuration(0)).toBe('0m');
    expect(formatDuration(45 * MINUTE)).toBe('45m');
    expect(formatDuration(60 * MINUTE)).toBe('1h');
    expect(formatDuration(65 * MINUTE)).toBe('1h 05m');
    expect(formatDuration(-5 * MINUTE)).toBe('0m');
  });

  it('writes the units the Portuguese way', () => {
    expect(formatDuration(45 * MINUTE, 'pt-BR')).toBe('45 min');
    expect(formatDuration(60 * MINUTE, 'pt-BR')).toBe('1 h');
    expect(formatDuration(65 * MINUTE, 'pt-BR')).toBe('1 h 05 min');
  });
});

describe('Intl helpers', () => {
  it('formats a 24-hour clock in both languages', () => {
    const afternoon = at(2026, 10, 21, 14).toISOString();
    expect(formatTime(afternoon, 'en')).toBe('14:00');
    expect(formatTime(afternoon, 'pt-BR')).toBe('14:00');
  });

  it('formats relative times', () => {
    const now = Date.UTC(2026, 9, 21, 12);
    expect(formatRelative(now + 24 * MINUTE, now, 'en')).toBe('in 24 minutes');
    expect(formatRelative(now + 24 * MINUTE, now, 'pt-BR')).toBe('em 24 minutos');
    expect(formatRelative(now - 3 * 60 * MINUTE, now, 'en')).toBe('3 hours ago');
  });

  it('uses the locale decimal separator', () => {
    expect(formatNumber(7.5, undefined, 'en')).toBe('7.5');
    expect(formatNumber(7.5, undefined, 'pt-BR')).toBe('7,5');
    expect(formatUnit(7.5, 'kilogram', 'pt-BR')).toBe('7,5 kg');
  });

  it('joins lists', () => {
    expect(formatList(['a', 'b', 'c'], 'conjunction', 'en')).toBe('a, b, and c');
    expect(formatList(['a', 'b', 'c'], 'conjunction', 'pt-BR')).toBe('a, b e c');
  });

  it('keeps calendar dates in their own day', () => {
    expect(formatDate('2026-10-21', 'dayMonthYear', 'en')).toBe('Oct 21, 2026');
    expect(formatDate('2026-10-21', 'dayMonthYear', 'pt-BR')).toBe('21 de out. de 2026');
  });
});
