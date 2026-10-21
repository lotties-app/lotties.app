import { beforeEach, describe, expect, it } from 'vitest';
import { napGuidance, napWindowKey, readSkippedNap, writeSkippedNap } from './napGuidance';

const iso = (h: number, m = 0) => new Date(2026, 9, 21, h, m).toISOString();
const span = { earliest: iso(7, 34), latest: iso(8, 4) };
const at = (h: number, m = 0) => new Date(2026, 9, 21, h, m);

describe('napGuidance', () => {
  it('suggests winding down 15 minutes before the window opens', () => {
    const guidance = napGuidance(span, at(6, 50));
    expect(guidance.kind).toBe('windDown');
    if (guidance.kind === 'windDown') expect(guidance.at.getTime()).toBe(at(7, 19).getTime());
  });

  it('follows the clock: soon, open, past', () => {
    expect(napGuidance(span, at(7, 25)).kind).toBe('soon');
    expect(napGuidance(span, at(7, 40)).kind).toBe('open');
    expect(napGuidance(span, at(8, 4)).kind).toBe('open');
    expect(napGuidance(span, at(8, 5)).kind).toBe('past');
  });
});

describe('skipped nap storage', () => {
  beforeEach(() => window.localStorage.clear());

  it('remembers the skipped window per baby and clears it', () => {
    expect(readSkippedNap('b1')).toBeNull();
    writeSkippedNap('b1', napWindowKey(span));
    expect(readSkippedNap('b1')).toBe(napWindowKey(span));
    expect(readSkippedNap('b2')).toBeNull();
    writeSkippedNap('b1', null);
    expect(readSkippedNap('b1')).toBeNull();
  });

  it('gives a new prediction a new key', () => {
    expect(napWindowKey(span)).not.toBe(napWindowKey({ ...span, latest: iso(8, 10) }));
  });
});
