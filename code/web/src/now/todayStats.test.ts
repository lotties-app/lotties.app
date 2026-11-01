import { describe, expect, it } from 'vitest';
import type { BabyEvent } from '../db/models';
import { event } from '../presets/presetFixtures';
import { DIAPER_TYPE, FEEDING_TYPE, SLEEP_TYPE } from '../test/builtInTypes';
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
      diapers: 0,
    });
    expect(hasTodayData(stats)).toBe(false);
    expect(hasTodayData({ ...stats, feeds: 1 })).toBe(true);
    expect(hasTodayData({ ...stats, lastNightMinutes: 600 })).toBe(true);
  });
});
