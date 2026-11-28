import { describe, expect, it } from 'vitest';
import type { BabyEvent } from '../db/models';
import { event } from '../presets/presetFixtures';
import { BREAST_PUMP_TYPE, DIAPER_TYPE, FEEDING_TYPE, SLEEP_TYPE } from '../test/builtInTypes';
import { hasTodayData, todayStats } from './todayStats';

const TYPES = [FEEDING_TYPE, SLEEP_TYPE, DIAPER_TYPE];
const NOW = new Date(2026, 9, 21, 14, 20);
const at = (h: number, m = 0, day = 21) => new Date(2026, 9, day, h, m).toISOString();

let n = 0;
function logged(
  typeId: string,
  start: string,
  end: string | null,
  payload: Record<string, unknown> = {},
  extra: Partial<BabyEvent> = {},
) {
  n += 1;
  return event({ id: `t${n}`, typeId, startedAt: start, endedAt: end, payload, ...extra });
}

describe('todayStats', () => {
  it('counts feeds, diapers and naps of today, and last night from the latest night sleep', () => {
    const events = [
      logged(SLEEP_TYPE.id, at(20, 40, 20), at(6, 30), { kind: 'night' }),
      logged(SLEEP_TYPE.id, at(9), at(10, 15), { kind: 'nap' }),
      logged(SLEEP_TYPE.id, at(12), at(12, 40), { kind: 'nap' }),
      logged(SLEEP_TYPE.id, at(6, 30), at(6, 30), { kind: 'woke_up' }),
      logged(FEEDING_TYPE.id, at(7), at(7), { method: 'bottle' }),
      logged(FEEDING_TYPE.id, at(11), at(11, 15), { method: 'breast' }),
      logged(DIAPER_TYPE.id, at(8), at(8), { content: 'WET' }),
      logged(DIAPER_TYPE.id, at(13), at(13), { content: 'DIRTY' }),
      logged(DIAPER_TYPE.id, at(23, 0, 20), at(23, 0, 20), { content: 'WET' }),
    ];
    expect(todayStats(events, TYPES, NOW)).toEqual({
      lastNightMinutes: 9 * 60 + 50,
      naps: { count: 2, minutes: 75 + 40 },
      feeds: 2,
      milk: null,
      diapers: 2,
    });
  });

  it('counts a running nap up to now and ignores deleted and future events', () => {
    const events = [
      logged(SLEEP_TYPE.id, at(13, 50), null, { kind: 'nap' }),
      logged(SLEEP_TYPE.id, at(9), at(10), { kind: 'nap' }, { deletedAt: at(10, 5) }),
      logged(FEEDING_TYPE.id, at(15), at(15), { method: 'bottle' }),
    ];
    expect(todayStats(events, TYPES, NOW)).toEqual({
      lastNightMinutes: null,
      naps: { count: 1, minutes: 30 },
      feeds: 0,
      milk: null,
      diapers: 0,
    });
  });

  it('a night sleep that ended more than a day ago is not "last night"', () => {
    const events = [logged(SLEEP_TYPE.id, at(20, 0, 19), at(6, 0, 20), { kind: 'night' })];
    expect(todayStats(events, TYPES, NOW).lastNightMinutes).toBeNull();
  });

  it('is empty without events, and the strip then has nothing to show', () => {
    const stats = todayStats([], TYPES, NOW);
    expect(stats).toEqual({
      lastNightMinutes: null,
      naps: { count: 0, minutes: 0 },
      feeds: 0,
      milk: null,
      diapers: 0,
    });
    expect(hasTodayData(stats)).toBe(false);
    expect(hasTodayData({ ...stats, feeds: 1 })).toBe(true);
    expect(hasTodayData({ ...stats, lastNightMinutes: 600 })).toBe(true);
  });
});

describe('todayStats bottle total', () => {
  const bottle = (
    start: string,
    end: string | null,
    payload: Record<string, unknown>,
    extra: Partial<BabyEvent> = {},
  ) => logged(FEEDING_TYPE.id, start, end, { method: 'bottle', ...payload }, extra);

  it('sums what was drunk: the drunk amount when logged, else the prepared one', () => {
    const events = [
      bottle(at(6), at(6), { amount_ml: 120 }),
      bottle(at(9), at(9, 20), { amount_ml: 150, amount_drunk_ml: 100 }),
      bottle(at(12), at(12), { amount_ml: 90, amount_drunk_ml: 200 }),
    ];
    const stats = todayStats(events, TYPES, NOW);
    expect(stats.milk?.drunkMl).toBe(120 + 100 + 90);
    expect(stats.milk?.preparedMl).toBe(120 + 150 + 90);
    expect(stats.feeds).toBe(3);
  });

  it('counts every bottle content but not nursing, solids or pumping', () => {
    const events = [
      bottle(at(6), at(6), { amount_ml: 100, bottle_feeding_type: 'formula' }),
      bottle(at(7), at(7), { amount_ml: 60, bottle_feeding_type: 'breast_milk' }),
      bottle(at(8), at(8), { amount_ml: 30, bottle_feeding_type: 'other' }),
      logged(FEEDING_TYPE.id, at(9), at(9, 15), { method: 'breast', amount_ml: 80 }),
      logged(FEEDING_TYPE.id, at(10), at(10), { method: 'solid', amount_ml: 50 }),
      logged(BREAST_PUMP_TYPE.id, at(11), at(11, 10), { amount_left_ml: 60, amount_ml: 120 }),
    ];
    const stats = todayStats(events, [...TYPES, BREAST_PUMP_TYPE], NOW);
    expect(stats.milk).toEqual({ drunkMl: 190, preparedMl: 190 });
    expect(stats.feeds).toBe(5);
  });

  it('leaves out a running bottle but still counts it as a feed', () => {
    const events = [
      bottle(at(10), at(10), { amount_ml: 120 }),
      bottle(at(14), null, { amount_ml: 150 }),
    ];
    const stats = todayStats(events, TYPES, NOW);
    expect(stats.milk).toEqual({ drunkMl: 120, preparedMl: 120 });
    expect(stats.feeds).toBe(2);
  });

  it('is null when no finished bottle of today has an amount', () => {
    const events = [
      bottle(at(7), at(7), {}),
      bottle(at(8), at(8), { amount_ml: 0 }),
      bottle(at(14), null, { amount_ml: 150 }),
      bottle(at(20, 0, 20), at(20, 0, 20), { amount_ml: 180 }),
      bottle(at(9), at(9), { amount_ml: 120 }, { deletedAt: at(9, 5) }),
      bottle(at(15), at(15), { amount_ml: 120 }),
      logged(FEEDING_TYPE.id, at(11), at(11, 15), { method: 'breast' }),
    ];
    const stats = todayStats(events, TYPES, NOW);
    expect(stats.milk).toBeNull();
    expect(stats.feeds).toBe(4);
  });

  it('counts a bottle with nothing drunk as prepared, not drunk', () => {
    const events = [
      bottle(at(7), at(7), { amount_ml: 120, amount_drunk_ml: 0 }),
      bottle(at(9), at(9), { amount_ml: 100, amount_drunk_ml: 60 }),
    ];
    expect(todayStats(events, TYPES, NOW).milk).toEqual({ drunkMl: 60, preparedMl: 220 });
  });

  it('shows a bottle of only zero drunk as 0 drunk of what was prepared', () => {
    const events = [bottle(at(7), at(7), { amount_ml: 120, amount_drunk_ml: 0 })];
    expect(todayStats(events, TYPES, NOW).milk).toEqual({ drunkMl: 0, preparedMl: 120 });
  });

  it('counts a bottle with only a drunk amount in both numbers', () => {
    const events = [
      bottle(at(7), at(7), { amount_drunk_ml: 70 }),
      bottle(at(9), at(9), { amount_ml: 100 }),
    ];
    expect(todayStats(events, TYPES, NOW).milk).toEqual({ drunkMl: 170, preparedMl: 170 });
  });

  it('never lets drunk exceed prepared', () => {
    const events = [
      bottle(at(7), at(7), { amount_ml: 90, amount_drunk_ml: 200 }),
      bottle(at(8), at(8), { amount_drunk_ml: 40 }),
      bottle(at(9), at(9), { amount_ml: 150, amount_drunk_ml: 30 }),
    ];
    const milk = todayStats(events, TYPES, NOW).milk;
    expect(milk).toEqual({ drunkMl: 160, preparedMl: 280 });
  });
});
