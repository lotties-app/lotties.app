import { describe, expect, it } from 'vitest';
import type { EventPayload } from '../db/models';
import vectors from './bottleSegmentsVectors.json';
import {
  addPause,
  canReshape,
  historyOnlyExtends,
  historyRows,
  historyTotals,
  rebaseHistory,
  removePause,
  setRowLevel,
  setRowTime,
  withHistoryTotals,
  type HistoryEdit,
} from './bottleHistory';
import { parseSegments } from './bottleSegments';

const S = Date.parse('2026-11-02T12:25:00.000Z');
const iso = (seconds: number) => new Date(S + seconds * 1000).toISOString();
const ms = (seconds: number) => S + seconds * 1000;

const ended = (payload: EventPayload, seconds: number) => ({
  startedAt: iso(0),
  endedAt: iso(seconds),
  payload,
});
const running = (payload: EventPayload) => ({ startedAt: iso(0), endedAt: null, payload });

/** Owner's example: 120 ml at 12:25, pause 12:31 left 80, resume 12:34, pause 12:47 left 15, asleep 12:53 while paused. */
const owner = () =>
  ended(
    {
      method: 'bottle',
      amount_ml: 120,
      amount_drunk_ml: 105,
      pause_count: 2,
      paused_seconds: 540,
      segments: '120>80@360+0;80>15@780+540',
    },
    1680,
  );

const payloadOf = (edit: HistoryEdit): EventPayload => {
  if ('problem' in edit) throw new Error(`refused: ${edit.problem}`);
  return edit.payload;
};

describe('the shared vectors (same as the API BottleHistory)', () => {
  it.each(vectors.totals.map((v) => [v.note, v] as const))('totals: %s', (_, vector) => {
    const segments = parseSegments(vector.segments)!;
    expect(
      historyTotals(segments, vector.lengthSeconds, vector.paused, vector.pausedSeconds),
    ).toEqual(vector.totals);
  });

  it.each(vectors.extends.map((v) => [v.note, v] as const))('extends: %s', (_, vector) => {
    expect(historyOnlyExtends(vector.before, vector.after)).toBe(vector.allowed);
  });
});

describe('the history rows', () => {
  it('shows start, each pause with what was left and drunk, each resume and the end', () => {
    const rows = historyRows(owner());
    expect(rows.map((r) => r.kind)).toEqual(['start', 'pause', 'resume', 'pause', 'end']);
    expect(rows.map((r) => r.atMs)).toEqual([ms(0), ms(360), ms(540), ms(1320), ms(1680)]);
    expect(rows.map((r) => r.levelMl)).toEqual([120, 80, 80, 15, 15]);
    expect(rows.map((r) => r.drunkMl)).toEqual([null, 40, null, 65, null]);
  });

  it('a running bottle drinking now ends with its last resume, from the pause totals', () => {
    const rows = historyRows(
      running({
        method: 'bottle',
        amount_ml: 120,
        pause_count: 1,
        paused_seconds: 180,
        segments: '120>80@360+0',
      }),
    );
    expect(rows.map((r) => [r.kind, r.atMs, r.open ?? false])).toEqual([
      ['start', ms(0), false],
      ['pause', ms(360), false],
      ['resume', ms(540), true],
    ]);
  });

  it('an old bottle without times shows its rows with the time unknown', () => {
    const rows = historyRows(
      ended({ method: 'bottle', amount_ml: 120, segments: '120>80@300;80>0@600' }, 1200),
    );
    expect(rows.map((r) => [r.kind, r.atMs])).toEqual([
      ['start', ms(0)],
      ['pause', null],
      ['resume', null],
      ['end', ms(1200)],
    ]);
  });
});

describe('editing a row', () => {
  it('moves a pause and recomputes the totals', () => {
    const bottle = owner();
    const pause = historyRows(bottle)[1];
    const payload = payloadOf(setRowTime(bottle, pause, ms(420)));
    expect(payload).toMatchObject({
      segments: '120>80@420+0;80>15@780+540',
      pause_count: 2,
      paused_seconds: 480,
    });
  });

  it('refuses a resume before its pause', () => {
    const bottle = owner();
    const resume = historyRows(bottle)[2];
    expect(setRowTime(bottle, resume, ms(300))).toEqual({ problem: 'order' });
  });

  it('changes a level and the next stretch starts there; never above the next level', () => {
    const bottle = owner();
    const pause = historyRows(bottle)[1];
    expect(payloadOf(setRowLevel(bottle, pause, 90)).segments).toBe('120>90@360+0;90>15@780+540');
    expect(setRowLevel(bottle, pause, 10)).toEqual({ problem: 'level' });
  });

  it('gives an old stretch a time, keeping its drinking time', () => {
    const bottle = ended(
      {
        method: 'bottle',
        amount_ml: 120,
        pause_count: 1,
        paused_seconds: 300,
        segments: '120>80@300;80>0@600',
      },
      1200,
    );
    expect(canReshape(bottle)).toBe(false);
    const payload = payloadOf(setRowTime(bottle, historyRows(bottle)[2], ms(600)));
    // The first stretch still has no time: the totals stay as the timer wrote them.
    expect(payload).toMatchObject({
      segments: '120>80@300;80>0@600+600',
      pause_count: 1,
      paused_seconds: 300,
    });
  });
});

describe('adding and removing a pause', () => {
  it('adds a missed pause to a running bottle, and removes it again', () => {
    const bottle = running({ method: 'bottle', amount_ml: 120 });
    const added = payloadOf(addPause(bottle, ms(300), ms(420), 80));
    expect(added).toMatchObject({ segments: '120>80@300+0', pause_count: 1, paused_seconds: 120 });
    const removed = payloadOf(removePause({ ...bottle, payload: added }, 0));
    expect(removed).not.toHaveProperty('segments');
    expect(removed).toMatchObject({ pause_count: 0, paused_seconds: 0 });
  });

  it('adds a pause to a finished bottle never paused', () => {
    const bottle = ended({ method: 'bottle', amount_ml: 120, amount_drunk_ml: 100 }, 1200);
    expect(payloadOf(addPause(bottle, ms(600), ms(660), 60))).toMatchObject({
      segments: '120>60@600+0;60>20@540+660',
      pause_count: 1,
      paused_seconds: 60,
    });
  });

  it('splits a stretch, and a removed pause merges the stretches around it', () => {
    const bottle = owner();
    const split = payloadOf(addPause(bottle, ms(1000), ms(1100), 40));
    expect(split).toMatchObject({
      segments: '120>80@360+0;80>40@460+540;40>15@220+1100',
      pause_count: 3,
      paused_seconds: 640,
    });
    expect(payloadOf(removePause(bottle, 0))).toMatchObject({
      segments: '120>15@1320+0',
      pause_count: 1,
      paused_seconds: 360,
    });
  });

  it('refuses a pause outside the drinking', () => {
    expect(addPause(owner(), ms(400), ms(500), 70)).toEqual({ problem: 'order' });
  });
});

describe('the totals follow the history on every save', () => {
  it('a running paused bottle counts the pauses between its stretches', () => {
    const payload = withHistoryTotals(
      {
        method: 'bottle',
        amount_ml: 120,
        paused_at: iso(600),
        segments: '120>80@360+0;80>?@60+540',
      },
      { startedAt: iso(0), endedAt: null },
    );
    expect(payload).toMatchObject({ pause_count: 1, paused_seconds: 180 });
  });

  it('keeps every pause at its clock time when the sheet moves the start and the end', () => {
    const payload = rebaseHistory(
      { method: 'bottle', segments: '120>80@300+0;80>0@240+360' },
      { startedAt: iso(30), endedAt: iso(630) },
      { startedAt: iso(0), endedAt: iso(600) },
    );
    expect(payload.segments).toBe('120>80@330+0;80>0@210+390');
  });
});
