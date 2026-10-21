import { describe, expect, it } from 'vitest';
import type { EventPayload } from '../db/models';
import {
  currentPauseSeconds,
  effectiveDurationSeconds,
  effectiveElapsedSeconds,
  effectiveMsInWindow,
  hasPauses,
  isPaused,
  normalizePause,
  pauseProblems,
  readPause,
  totalPausedSeconds,
  withPause,
  withResume,
} from './pauseMath';

const at = (iso: string) => new Date(iso);
const timer = (
  payload: EventPayload,
  startedAt = '2026-10-20T08:00:00.000Z',
  endedAt: string | null = null,
) => ({ payload, startedAt, endedAt });

describe('effective elapsed and duration', () => {
  it('is the plain elapsed without pause keys', () => {
    const event = timer({});
    expect(effectiveElapsedSeconds(event, at('2026-10-20T08:30:00.000Z'))).toBe(1800);
    expect(effectiveDurationSeconds(timer({}, event.startedAt, '2026-10-20T09:00:00.000Z'))).toBe(
      3600,
    );
  });

  it('removes the finished pauses', () => {
    const event = timer({ pause_count: 2, paused_seconds: 600 });
    expect(effectiveElapsedSeconds(event, at('2026-10-20T08:30:00.000Z'))).toBe(1200);
  });

  it('stops counting while paused and shows the open pause live', () => {
    const event = timer({
      pause_count: 1,
      paused_seconds: 300,
      paused_at: '2026-10-20T08:20:00.000Z',
    });
    const now = at('2026-10-20T08:30:10.000Z');
    expect(isPaused(event)).toBe(true);
    expect(currentPauseSeconds(event, now)).toBe(610);
    expect(totalPausedSeconds(event, now)).toBe(910);
    // 30m10s wall - 5m - 10m10s = 15m
    expect(effectiveElapsedSeconds(event, now)).toBe(900);
    // The elapsed is frozen: a minute later it is the same.
    expect(effectiveElapsedSeconds(event, at('2026-10-20T08:31:10.000Z'))).toBe(900);
  });

  it('never goes below zero', () => {
    const event = timer({ paused_seconds: 5000 });
    expect(effectiveElapsedSeconds(event, at('2026-10-20T08:10:00.000Z'))).toBe(0);
  });

  it('ignores a stray paused_at on a stopped event', () => {
    const event = timer(
      { paused_at: '2026-10-20T08:50:00.000Z', paused_seconds: 60 },
      '2026-10-20T08:00:00.000Z',
      '2026-10-20T09:00:00.000Z',
    );
    expect(isPaused(event)).toBe(false);
    expect(effectiveDurationSeconds(event)).toBe(3540);
  });

  it('works across midnight and DST-free instants', () => {
    const event = timer({ paused_seconds: 900 }, '2026-10-20T23:30:00.000Z');
    expect(effectiveElapsedSeconds(event, at('2026-10-21T00:45:00.000Z'))).toBe(75 * 60 - 900);
    const finished = timer(
      { paused_seconds: 1200, pause_count: 2 },
      '2026-10-20T23:00:00.000Z',
      '2026-10-21T01:00:00.000Z',
    );
    expect(effectiveDurationSeconds(finished)).toBe(6000);
  });

  it('reads damaged keys as no pause', () => {
    const pause = readPause({ pause_count: 'x', paused_seconds: -4, paused_at: 'nope' });
    expect(pause).toEqual({ count: 0, pausedSeconds: 0, pausedAt: null });
    expect(hasPauses({ payload: { pause_count: 1 } })).toBe(true);
    expect(hasPauses({ payload: {} })).toBe(false);
  });
});

describe('pause and resume payloads', () => {
  it('pauses once and resumes with several pauses adding up', () => {
    let payload: EventPayload = { method: 'breast' };
    payload = withPause(payload, at('2026-10-20T08:10:00.000Z'));
    expect(payload).toMatchObject({ paused_at: '2026-10-20T08:10:00.000Z' });
    // Pausing a paused timer keeps the first instant.
    expect(withPause(payload, at('2026-10-20T08:12:00.000Z'))).toEqual(payload);

    payload = withResume(payload, at('2026-10-20T08:15:00.000Z'));
    expect(payload).toEqual({ method: 'breast', paused_seconds: 300, pause_count: 1 });

    payload = withPause(payload, at('2026-10-20T08:20:00.000Z'));
    payload = withResume(payload, at('2026-10-20T08:22:30.000Z'));
    expect(payload).toEqual({ method: 'breast', paused_seconds: 450, pause_count: 2 });
    // Resuming a timer that is not paused changes nothing.
    expect(withResume(payload, at('2026-10-20T09:00:00.000Z'))).toEqual(payload);
  });

  it('moves an open nursing segment forward by the pause', () => {
    const payload = withPause(
      { side: 'left', side_since: '2026-10-20T08:00:00.000Z' },
      at('2026-10-20T08:10:00.000Z'),
    );
    const resumed = withResume(payload, at('2026-10-20T08:14:00.000Z'));
    expect(resumed.side_since).toBe('2026-10-20T08:04:00.000Z');
  });

  it('a pause across midnight adds the real length', () => {
    const paused = withPause({}, at('2026-10-20T23:50:00.000Z'));
    expect(withResume(paused, at('2026-10-21T00:10:00.000Z'))).toMatchObject({
      paused_seconds: 1200,
      pause_count: 1,
    });
  });
});

describe('normalizePause (stop while paused, API rules)', () => {
  it('returns payloads without pause keys untouched', () => {
    const payload = { kind: 'nap' };
    expect(normalizePause(payload, '2026-10-20T08:00:00.000Z', '2026-10-20T09:00:00.000Z')).toBe(
      payload,
    );
  });

  it('folds the open pause in at the end', () => {
    const payload = normalizePause(
      { paused_at: '2026-10-20T08:40:00.000Z', paused_seconds: 60, pause_count: 1 },
      '2026-10-20T08:00:00.000Z',
      '2026-10-20T09:00:00.000Z',
    );
    expect(payload).toEqual({ paused_seconds: 1260, pause_count: 2 });
  });

  it('keeps a running timer paused', () => {
    const payload = { paused_at: '2026-10-20T08:40:00.000Z' };
    expect(normalizePause(payload, '2026-10-20T08:00:00.000Z', null)).toEqual(payload);
  });

  it('caps paused_seconds at the length and drops an unreadable paused_at', () => {
    expect(
      normalizePause(
        { paused_seconds: 7200, paused_at: 'nope' },
        '2026-10-20T08:00:00.000Z',
        '2026-10-20T09:00:00.000Z',
      ),
    ).toEqual({ paused_seconds: 3600 });
  });

  it('a pause that began after the end adds nothing', () => {
    const payload = normalizePause(
      { paused_at: '2026-10-20T09:30:00.000Z' },
      '2026-10-20T08:00:00.000Z',
      '2026-10-20T09:00:00.000Z',
    );
    expect(payload).toMatchObject({ paused_seconds: 0, pause_count: 1 });
    expect(payload).not.toHaveProperty('paused_at');
  });
});

describe('pauseProblems', () => {
  const start = '2026-10-20T08:00:00.000Z';
  const end = '2026-10-20T09:00:00.000Z';

  it('accepts valid keys', () => {
    expect(pauseProblems({ pause_count: 2, paused_seconds: 600 }, start, end)).toEqual([]);
    expect(pauseProblems({ paused_at: '2026-10-20T08:30:00Z' }, start, null)).toEqual([]);
  });

  it('flags non-integers, ranges, a paused_at once ended and a pause longer than the event', () => {
    expect(pauseProblems({ pause_count: 1.5 }, start, end)).toEqual([
      { field: 'pause_count', code: 'number' },
    ]);
    expect(pauseProblems({ pause_count: 101 }, start, end)).toEqual([
      { field: 'pause_count', code: 'max' },
    ]);
    expect(pauseProblems({ paused_seconds: -1 }, start, null)).toEqual([
      { field: 'paused_seconds', code: 'min' },
    ]);
    expect(pauseProblems({ paused_seconds: 4000 }, start, end)).toEqual([
      { field: 'paused_seconds', code: 'max' },
    ]);
    expect(pauseProblems({ paused_seconds: 4000 }, start, null)).toEqual([]);
    expect(pauseProblems({ paused_at: 'later' }, start, null)).toEqual([
      { field: 'paused_at', code: 'instant' },
    ]);
    expect(pauseProblems({ paused_at: '2026-10-20T08:30:00Z' }, start, end)).toEqual([
      { field: 'paused_at', code: 'ended' },
    ]);
  });
});

describe('effectiveMsInWindow', () => {
  it('spreads the pauses over the event for a clipped window', () => {
    const event = timer(
      { paused_seconds: 1800 },
      '2026-10-20T22:00:00.000Z',
      '2026-10-21T02:00:00.000Z',
    );
    // 4 h event, 30 min paused: 3.5 h effective; half of the event is before midnight.
    const midnight = Date.parse('2026-10-21T00:00:00.000Z');
    const before = effectiveMsInWindow(event, 0, midnight);
    const after = effectiveMsInWindow(event, midnight, Date.parse('2026-10-22T00:00:00.000Z'));
    expect(before).toBe(1.75 * 3_600_000);
    expect(before + after).toBe(3.5 * 3_600_000);
  });
});
