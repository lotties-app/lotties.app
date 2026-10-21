import { describe, expect, it } from 'vitest';
import { decideNightFeed, isInNightWindow, nightPeriodKey, type NightFeedState } from './nightFeed';
import {
  loadNightFeedSetting,
  loadNightFeedState,
  NIGHT_FEED_STATE_STORAGE_KEY,
  NIGHT_FEED_STORAGE_KEY,
} from './nightFeedStorage';

const at = (iso: string) => new Date(iso); // local time (no zone suffix)
const NONE: NightFeedState = { override: null, dismissedKey: null };

describe('isInNightWindow', () => {
  it.each([
    ['2026-10-21T21:59:59', false],
    ['2026-10-21T22:00:00', true],
    ['2026-10-21T23:30:00', true],
    ['2026-10-22T00:00:00', true],
    ['2026-10-22T04:59:59', true],
    ['2026-10-22T05:00:00', false],
    ['2026-10-22T12:00:00', false],
  ])('%s -> %s', (iso, expected) => {
    expect(isInNightWindow(at(iso))).toBe(expected);
  });
});

describe('nightPeriodKey', () => {
  it('names a night after the evening it started and changes at both boundaries', () => {
    expect(nightPeriodKey(at('2026-10-21T23:00:00'))).toBe('n:2026-10-21');
    expect(nightPeriodKey(at('2026-10-22T03:00:00'))).toBe('n:2026-10-21');
    expect(nightPeriodKey(at('2026-10-22T05:00:00'))).toBe('d:2026-10-22');
    expect(nightPeriodKey(at('2026-10-22T21:59:00'))).toBe('d:2026-10-22');
    expect(nightPeriodKey(at('2026-10-22T22:00:00'))).toBe('n:2026-10-22');
  });

  it('handles month and year boundaries', () => {
    expect(nightPeriodKey(at('2027-01-01T01:00:00'))).toBe('n:2026-12-31');
  });
});

describe('decideNightFeed', () => {
  const night = at('2026-10-22T01:00:00');
  const day = at('2026-10-22T15:00:00');

  it('off never suggests and never switches', () => {
    expect(decideNightFeed('off', night, NONE)).toMatchObject({ active: false, suggest: false });
  });

  it('ask suggests in the window only, until dismissed', () => {
    expect(decideNightFeed('ask', night, NONE)).toMatchObject({ active: false, suggest: true });
    expect(decideNightFeed('ask', day, NONE)).toMatchObject({ active: false, suggest: false });
    const key = nightPeriodKey(night);
    expect(decideNightFeed('ask', night, { ...NONE, dismissedKey: key }).suggest).toBe(false);
    // A dismissal from last night does not silence tonight.
    expect(decideNightFeed('ask', night, { ...NONE, dismissedKey: 'n:2026-10-20' }).suggest).toBe(
      true,
    );
  });

  it('auto switches in the window and back after it', () => {
    expect(decideNightFeed('auto', night, NONE)).toMatchObject({ active: true, suggest: false });
    expect(decideNightFeed('auto', day, NONE).active).toBe(false);
  });

  it('an explicit choice wins until the next window boundary, then expires', () => {
    const key = nightPeriodKey(night);
    expect(decideNightFeed('ask', night, { ...NONE, override: { on: true, key } })).toMatchObject({
      active: true,
      suggest: false,
    });
    expect(decideNightFeed('auto', night, { ...NONE, override: { on: false, key } }).active).toBe(
      false,
    );
    // Same state after 05:00: the key changed, so the choice no longer applies.
    expect(decideNightFeed('auto', day, { ...NONE, override: { on: true, key } }).active).toBe(
      false,
    );
  });

  it('works with the setting off for a manual toggle (quick toggle in the menu)', () => {
    const key = nightPeriodKey(day);
    expect(decideNightFeed('off', day, { ...NONE, override: { on: true, key } }).active).toBe(true);
  });
});

describe('night feed storage', () => {
  it('defaults the setting to ask and ignores unknown values', () => {
    expect(loadNightFeedSetting()).toBe('ask');
    window.localStorage.setItem(NIGHT_FEED_STORAGE_KEY, 'sometimes');
    expect(loadNightFeedSetting()).toBe('ask');
    window.localStorage.setItem(NIGHT_FEED_STORAGE_KEY, 'auto');
    expect(loadNightFeedSetting()).toBe('auto');
  });

  it('validates the stored state field by field', () => {
    window.localStorage.setItem(
      NIGHT_FEED_STATE_STORAGE_KEY,
      '{"override":{"on":"yes"},"dismissedKey":3}',
    );
    expect(loadNightFeedState()).toEqual({ override: null, dismissedKey: null });
    window.localStorage.setItem(NIGHT_FEED_STATE_STORAGE_KEY, 'not json');
    expect(loadNightFeedState()).toEqual({ override: null, dismissedKey: null });
    window.localStorage.setItem(
      NIGHT_FEED_STATE_STORAGE_KEY,
      '{"override":{"on":true,"key":"n:2026-10-21"},"dismissedKey":"d:2026-10-21"}',
    );
    expect(loadNightFeedState()).toEqual({
      override: { on: true, key: 'n:2026-10-21' },
      dismissedKey: 'd:2026-10-21',
    });
  });
});
