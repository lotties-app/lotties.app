import { describe, expect, it } from 'vitest';
import vectors from './birthWeekVectors.json';
import { mondayOf } from './birthWeek';

describe('mondayOf', () => {
  it.each(vectors.monday)('$date -> $monday', ({ date, monday }) => {
    expect(mondayOf(date)).toBe(monday);
  });

  it('leaves unreadable text alone', () => {
    expect(mondayOf('')).toBe('');
  });
});
