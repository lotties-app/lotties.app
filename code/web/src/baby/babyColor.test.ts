import { describe, expect, it } from 'vitest';
import { babyColor, babyInitial } from './babyColor';

describe('babyColor', () => {
  it('is deterministic and differs between ids', () => {
    expect(babyColor('baby-1')).toBe(babyColor('baby-1'));
    expect(babyColor('baby-1')).not.toBe(babyColor('baby-2'));
    expect(babyColor('baby-1')).toMatch(/^hsl\(\d{1,3}, 45%, 32%\)$/);
  });

  it('takes the first letter, upper-cased, or ? for an empty name', () => {
    expect(babyInitial('  lia')).toBe('L');
    expect(babyInitial('')).toBe('?');
  });
});
