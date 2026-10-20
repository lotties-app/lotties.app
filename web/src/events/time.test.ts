import { describe, expect, it } from 'vitest';
import { formatElapsed, fromLocalInput, toLocalInput } from './time';

describe('formatElapsed', () => {
  it('formats minutes and hours and never goes negative', () => {
    expect(formatElapsed(0)).toBe('00:00');
    expect(formatElapsed(65_000)).toBe('01:05');
    expect(formatElapsed(3_725_000)).toBe('1:02:05');
    expect(formatElapsed(-5000)).toBe('00:00');
  });
});

describe('local input conversion', () => {
  it('round-trips through UTC at minute precision', () => {
    const iso = '2026-10-20T08:15:00.000Z';
    expect(fromLocalInput(toLocalInput(iso))).toBe(iso);
  });

  it('treats the input as local time', () => {
    const local = new Date(2026, 9, 20, 5, 30);
    expect(fromLocalInput('2026-10-20T05:30')).toBe(local.toISOString());
    expect(fromLocalInput('')).toBeNull();
  });
});
