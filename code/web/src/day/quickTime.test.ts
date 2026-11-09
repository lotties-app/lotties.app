import { describe, expect, it } from 'vitest';
import {
  atClock,
  clockOf,
  isMomentEntry,
  nudged,
  quickTimeAllowed,
  quickTimeChanges,
  quickTimeProblem,
} from './quickTime';

const at = (h: number, m: number) => new Date(2026, 9, 20, h, m);

describe('quickTimeAllowed', () => {
  it('lets plain entries through', () => {
    expect(quickTimeAllowed({ payload: { content: 'WET' } })).toBe(true);
    expect(quickTimeAllowed({ payload: { kind: 'nap' } })).toBe(true);
  });

  it.each([
    ['a bottle history', { segments: '120>80@300+0' }],
    ['a pause', { pause_count: 1, paused_seconds: 60 }],
    ['an open pause', { paused_at: '2026-10-20T10:00:00.000Z' }],
    ['an open nursing side', { side_since: '2026-10-20T10:00:00.000Z' }],
    ['nursing side times', { breast_left_seconds: 300 }],
  ])('sends %s to the full sheet', (_, payload) => {
    expect(quickTimeAllowed({ payload })).toBe(false);
  });
});

describe('quick time arithmetic', () => {
  it('reads and sets the local clock on the same day', () => {
    expect(clockOf(at(6, 4))).toBe('06:04');
    expect(atClock(at(6, 4), '07:30')).toEqual(at(7, 30));
    expect(atClock(at(6, 4), '')).toBeNull();
    expect(atClock(at(6, 4), '25:00')).toBeNull();
  });

  it('nudges across midnight', () => {
    expect(nudged(at(0, 5), -15)).toEqual(new Date(2026, 9, 19, 23, 50));
  });

  it('flags an end before the start and a running start after now', () => {
    expect(quickTimeProblem(at(8, 0), at(7, 0), false, at(9, 0))).toBe('endBeforeStart');
    expect(quickTimeProblem(at(10, 0), null, true, at(9, 0))).toBe('startInFuture');
    expect(quickTimeProblem(at(8, 0), at(8, 30), false, at(9, 0))).toBeNull();
  });

  it('keeps a moment a moment and a running entry running', () => {
    const iso = (d: Date) => d.toISOString();
    const moment = { startedAt: iso(at(8, 0)), endedAt: iso(at(8, 0)) };
    expect(isMomentEntry(moment)).toBe(true);
    expect(quickTimeChanges(moment, at(8, 5), null)).toEqual({
      startedAt: iso(at(8, 5)),
      endedAt: iso(at(8, 5)),
    });
    expect(quickTimeChanges({ startedAt: iso(at(8, 0)), endedAt: null }, at(7, 55), null)).toEqual(
      { startedAt: iso(at(7, 55)), endedAt: null },
    );
    expect(
      quickTimeChanges({ startedAt: iso(at(8, 0)), endedAt: iso(at(9, 0)) }, at(8, 5), at(9, 10)),
    ).toEqual({ startedAt: iso(at(8, 5)), endedAt: iso(at(9, 10)) });
  });
});
