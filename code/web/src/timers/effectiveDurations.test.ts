import { describe, expect, it } from 'vitest';
import type { BabyEvent } from '../db/models';
import { dayBounds, summarizeDay, withSessionSeparators } from '../day/dayModel';
import { catchUp } from '../now/catchUp';
import { deriveNowState } from '../now/nowState';
import { buildRing } from '../now/ringGeometry';
import { forgottenTimer } from '../now/timers';
import { todayStats } from '../now/todayStats';
import { BUILT_IN_TYPES, FEEDING_T, SLEEP, event } from '../presets/presetFixtures';

/*
 * Durations shown or summed anywhere are effective ones: the pauses are not time asleep or fed.
 */

const at = (h: number, m = 0, day = 21) => new Date(2026, 9, day, h, m, 0);
const iso = (h: number, m = 0, day = 21) => at(h, m, day).toISOString();

let seq = 0;
function sleep(start: string, end: string | null, payload: Record<string, unknown>): BabyEvent {
  seq += 1;
  return event({ id: `p${seq}`, typeId: SLEEP, startedAt: start, endedAt: end, payload });
}

describe('Now state', () => {
  it('counts the asleep minutes without the finished pauses', () => {
    const nap = sleep(iso(13), null, { kind: 'nap', paused_seconds: 600, pause_count: 1 });
    const state = deriveNowState([nap], BUILT_IN_TYPES, undefined, at(14, 0));
    expect(state).toMatchObject({ kind: 'asleep', minutes: 50 });
    expect(state).not.toHaveProperty('paused');
  });

  it('stands still while paused and says since when', () => {
    const nap = sleep(iso(13), null, { kind: 'nap', paused_at: iso(13, 30) });
    const early = deriveNowState([nap], BUILT_IN_TYPES, undefined, at(13, 40));
    const late = deriveNowState([nap], BUILT_IN_TYPES, undefined, at(14, 20));
    expect(early).toMatchObject({ kind: 'asleep', minutes: 30, paused: { since: iso(13, 30) } });
    expect(late).toMatchObject({ kind: 'asleep', minutes: 30 });
  });

  it('a pause is not waking up: the state stays asleep', () => {
    const nap = sleep(iso(13), null, { kind: 'nap', paused_at: iso(13, 30) });
    expect(deriveNowState([nap], BUILT_IN_TYPES, undefined, at(15, 0)).kind).toBe('asleep');
  });
});

describe('forgotten timers use the effective elapsed time', () => {
  it('a long pause keeps a nap under its 4 h threshold', () => {
    const nap = sleep(iso(8), null, { kind: 'nap', paused_seconds: 3600 * 2, pause_count: 1 });
    // 5 h wall, 2 h paused: 3 h effective.
    expect(forgottenTimer(nap, BUILT_IN_TYPES, [nap], at(13, 0))).toBeUndefined();
    expect(forgottenTimer(nap, BUILT_IN_TYPES, [nap], at(15, 0))).toBeDefined();
  });

  it('a pause longer than 2 h counts as forgotten, and the suggested end is where it began', () => {
    const nap = sleep(iso(10), null, { kind: 'nap', paused_at: iso(10, 40) });
    expect(forgottenTimer(nap, BUILT_IN_TYPES, [nap], at(12, 30))).toBeUndefined();
    const forgotten = forgottenTimer(nap, BUILT_IN_TYPES, [nap], at(13, 0));
    expect(forgotten?.suggestedEnd).toBe(iso(10, 40));
  });
});

describe('totals', () => {
  it("today's nap total and last night use effective minutes", () => {
    const events = [
      sleep(iso(9), iso(10), { kind: 'nap', paused_seconds: 900 }),
      sleep(iso(20, 0, 20), iso(6, 0), { kind: 'night', paused_seconds: 1800 }),
    ];
    expect(todayStats(events, BUILT_IN_TYPES, at(14, 20))).toMatchObject({
      naps: { count: 1, minutes: 45 },
      lastNightMinutes: 9 * 60 + 30,
    });
  });

  it('the day summary adds effective minutes and the separator shows the effective length', () => {
    const nap = sleep(iso(9), iso(10, 30), { kind: 'nap', paused_seconds: 1200 });
    const bounds = dayBounds(at(12));
    expect(summarizeDay([nap], BUILT_IN_TYPES, bounds, at(12)).sleepMinutes).toBe(70);
    const [separator] = withSessionSeparators([nap], BUILT_IN_TYPES).filter(
      (item) => item.kind === 'separator',
    );
    expect(separator).toMatchObject({ durationMs: 70 * 60_000 });
  });

  it('a night across midnight splits the pause evenly and the two days add up', () => {
    const night = sleep(iso(22, 0, 20), iso(6, 0, 21), { kind: 'night', paused_seconds: 1600 });
    const before = summarizeDay([night], BUILT_IN_TYPES, dayBounds(at(12, 0, 20)), at(23, 59, 20));
    const after = summarizeDay([night], BUILT_IN_TYPES, dayBounds(at(12, 0, 21)), at(23, 0, 21));
    // 8 h wall, 1600 s paused: 453.33 min effective; 2 h of 8 h are before midnight.
    expect(before.sleepMinutes + after.sleepMinutes).toBeGreaterThanOrEqual(453);
    expect(before.sleepMinutes + after.sleepMinutes).toBeLessThanOrEqual(455);
    expect(before.sleepMinutes).toBeLessThan(after.sleepMinutes);
  });

  it('the hand-over card sums effective sleep minutes', () => {
    const nap = {
      ...sleep(iso(9), iso(10), { kind: 'nap', paused_seconds: 600 }),
      createdBy: 'u1',
      createdAt: iso(10, 5),
    };
    const result = catchUp([nap], [{ userId: 'u1', displayName: 'Vini' }], iso(7), at(12), {
      types: BUILT_IN_TYPES,
    });
    expect(result?.groups[0].sleep).toMatchObject({ count: 1, totalMinutes: 50 });
  });

  it('the ring adds effective minutes slept today', () => {
    const nap = sleep(iso(9), iso(10), { kind: 'nap', paused_seconds: 900 });
    expect(buildRing({ events: [nap], types: BUILT_IN_TYPES, now: at(12) }).sleptMinutes).toBe(45);
  });
});

describe('nursing sessions', () => {
  it('keeps the plain duration when nothing was paused', () => {
    const feed = event({
      id: 'f',
      typeId: FEEDING_T,
      startedAt: iso(9),
      endedAt: iso(9, 20),
      payload: { method: 'breast' },
    });
    const bounds = dayBounds(at(12));
    expect(summarizeDay([feed], BUILT_IN_TYPES, bounds, at(12)).feeds).toBe(1);
  });
});
