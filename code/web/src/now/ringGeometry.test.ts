import { describe, expect, it } from 'vitest';
import type { BabyEvent, EventType } from '../db/models';
import { SLEEP_TYPE } from '../test/builtInTypes';
import {
  angleOf,
  arcPath,
  buildRing,
  dayFrame,
  polar,
  spanAngles,
  wrappedSpanAngles,
} from './ringGeometry';

const at = (h: number, m = 0, dayOffset = 0) => new Date(2026, 9, 21 + dayOffset, h, m);
const frame = dayFrame(at(12));
const HOUR = 3_600_000;

describe('angleOf', () => {
  it('puts midnight at the top, six at a quarter and noon at the bottom', () => {
    expect(angleOf(at(0).getTime(), frame)).toBe(0);
    expect(angleOf(at(6).getTime(), frame)).toBe(90);
    expect(angleOf(at(12).getTime(), frame)).toBe(180);
    expect(angleOf(at(18).getTime(), frame)).toBe(270);
  });

  it('clamps instants outside the day', () => {
    expect(angleOf(at(23, 0, -1).getTime(), frame)).toBe(0);
    expect(angleOf(at(3, 0, 1).getTime(), frame)).toBe(360);
  });

  it('measures the day by its real length (DST days are 23 or 25 hours)', () => {
    const other = dayFrame(new Date(2026, 9, 25, 12));
    const length = other.end - other.start;
    expect(angleOf(other.start + length / 2, other)).toBe(180);
  });
});

describe('spanAngles', () => {
  it('clips a sleep that began yesterday to the top of the face', () => {
    expect(spanAngles(at(20, 0, -1).getTime(), at(6, 30).getTime(), frame)).toEqual([
      { from: 0, to: 97.5 },
    ]);
  });

  it('clips a span that continues past midnight to the end of the face', () => {
    expect(spanAngles(at(22).getTime(), at(5, 0, 1).getTime(), frame)).toEqual([
      { from: 330, to: 360 },
    ]);
  });

  it('is empty outside the day or without length', () => {
    expect(spanAngles(at(8, 0, -1).getTime(), at(9, 0, -1).getTime(), frame)).toEqual([]);
    expect(spanAngles(at(8).getTime(), at(8).getTime(), frame)).toEqual([]);
  });
});

describe('wrappedSpanAngles', () => {
  it('draws a window that crosses midnight on both sides of the top', () => {
    const late = dayFrame(at(23, 30));
    const parts = wrappedSpanAngles(at(23, 50).getTime(), at(0, 20, 1).getTime(), late);
    expect(parts).toHaveLength(2);
    expect(parts[0].to).toBe(360);
    expect(parts[1]).toEqual({ from: 0, to: 5 });
  });
});

describe('polar and arcPath', () => {
  it('maps angles clockwise from the top', () => {
    const top = polar(50, 50, 40, 0);
    const right = polar(50, 50, 40, 90);
    expect(top.x).toBeCloseTo(50);
    expect(top.y).toBeCloseTo(10);
    expect(right.x).toBeCloseTo(90);
    expect(right.y).toBeCloseTo(50);
  });

  it('sets the large-arc flag past half a turn and is empty for no sweep', () => {
    expect(arcPath(50, 50, 40, 0, 90)).toContain('A 40 40 0 0 1');
    expect(arcPath(50, 50, 40, 0, 200)).toContain('A 40 40 0 1 1');
    expect(arcPath(50, 50, 40, 10, 10)).toBe('');
    expect(arcPath(50, 50, 40, 0, 360)).toContain('A 40 40 0 1 1');
  });
});

const sleep = (id: string, from: Date, to: Date | null, kind: string): BabyEvent => ({
  id,
  babyId: 'b',
  typeId: SLEEP_TYPE.id,
  startedAt: from.toISOString(),
  endedAt: to ? to.toISOString() : null,
  payload: { kind },
  notes: null,
  createdBy: null,
  createdAt: from.toISOString(),
  updatedAt: from.toISOString(),
  deletedAt: null,
});

describe('buildRing', () => {
  const types: EventType[] = [SLEEP_TYPE];
  const now = at(14, 0);

  it('collects the sleep of today, the wake-up marker and the angle of now', () => {
    const ring = buildRing({
      events: [
        sleep('night', at(20, 0, -1), at(6, 30), 'night'),
        sleep('nap', at(9, 0), at(10, 0), 'nap'),
        sleep('run', at(13, 30), null, 'nap'),
      ],
      types,
      now,
    });
    expect(ring.spans.map((s) => [s.id, s.kind])).toEqual([
      ['night', 'night'],
      ['nap', 'nap'],
      ['run', 'nap'],
    ]);
    expect(ring.spans[0].from).toBe(0);
    expect(ring.nowAngle).toBe(210);
    expect(ring.sleptMinutes).toBe(6 * 60 + 30 + 60 + 30);
    expect(ring.markers.map((m) => m.kind)).toEqual(['wake']);
  });

  it('adds a bedtime marker without drawing a span for it', () => {
    const ring = buildRing({
      events: [sleep('bed', at(13, 0), at(13, 0), 'bed_time')],
      types,
      now,
    });
    expect(ring.markers.map((m) => m.kind)).toEqual(['bed']);
    expect(ring.spans).toEqual([]);
  });

  it('keeps only the predicted windows that are still ahead and inside the day', () => {
    const ring = buildRing({
      events: [],
      types,
      now,
      windows: [
        {
          earliest: new Date(now.getTime() - HOUR).toISOString(),
          latest: new Date(now.getTime() - 1).toISOString(),
        },
        { earliest: at(15, 0).toISOString(), latest: at(15, 30).toISOString() },
        { earliest: at(23, 50).toISOString(), latest: at(0, 30, 1).toISOString() },
      ],
    });
    expect(ring.windows.map((w) => w.id)).toEqual(['window-1', 'window-2']);
    expect(ring.windows[1].to).toBe(360);
  });

  it('ignores deleted events and events in the future', () => {
    const deleted = { ...sleep('gone', at(9), at(10), 'nap'), deletedAt: at(11).toISOString() };
    const ring = buildRing({
      events: [deleted, sleep('later', at(16), at(17), 'nap')],
      types,
      now,
    });
    expect(ring.spans).toEqual([]);
  });
});
