import { describe, expect, it } from 'vitest';
import type { BabyEvent, EventType } from '../db/models';
import { SLEEP_TYPE } from '../test/builtInTypes';
import {
  angleDistance,
  angleOf,
  arcPath,
  buildRing,
  dayFrame,
  placeRingLabels,
  polar,
  RING_LABEL_CLEARANCE,
  ringHourLabels,
  ringLegendKeys,
  sectorPath,
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

  it('draws a running sleep up to now and counts it', () => {
    const ring = buildRing({ events: [sleep('run', at(13, 0), null, 'nap')], types, now });
    expect(ring.spans).toEqual([{ id: 'run', kind: 'nap', from: 195, to: 210 }]);
    expect(ring.sleptMinutes).toBe(60);
  });

  it('has nothing but now on an empty day', () => {
    const ring = buildRing({ events: [], types, now });
    expect(ring.spans).toEqual([]);
    expect(ring.windows).toEqual([]);
    expect(ring.sleptMinutes).toBe(0);
    expect(ringLegendKeys(ring)).toEqual(['now']);
  });

  it('cuts a window that crosses midnight at the end of the face, not at the top', () => {
    const late = at(23, 30);
    const ring = buildRing({
      events: [],
      types,
      now: late,
      windows: [{ earliest: at(23, 45).toISOString(), latest: at(0, 40, 1).toISOString() }],
    });
    expect(ring.windows).toHaveLength(1);
    expect(ring.windows[0].from).toBeCloseTo(356.25);
    expect(ring.windows[0].to).toBe(360);
  });
});

describe('sectorPath', () => {
  it('closes a band between two radii and is empty without sweep', () => {
    const path = sectorPath(50, 50, 30, 40, 0, 90);
    expect(path.startsWith('M 50 10 A 40 40 0 0 1 90 50 L 80 50 A 30 30 0 0 0 50 20')).toBe(true);
    expect(path.endsWith('Z')).toBe(true);
    expect(sectorPath(50, 50, 30, 40, 10, 10)).toBe('');
    expect(sectorPath(50, 50, 30, 40, 0, 270)).toContain('A 40 40 0 1 1');
  });
});

describe('label collision avoidance', () => {
  it('measures distance around the face both ways', () => {
    expect(angleDistance(350, 10)).toBe(20);
    expect(angleDistance(0, 360)).toBe(0);
    expect(angleDistance(90, 270)).toBe(180);
  });

  it('keeps two labels apart by dropping the less important one', () => {
    const kept = placeRingLabels(
      [
        { key: 'a', angle: 100, priority: 1 },
        { key: 'b', angle: 105, priority: 2 },
        { key: 'c', angle: 200, priority: 1 },
      ],
      { minDegrees: 12 },
    );
    expect(kept.map((label) => label.key)).toEqual(['b', 'c']);
  });

  it('keeps labels apart across midnight', () => {
    const kept = placeRingLabels(
      [
        { key: 'late', angle: 355, priority: 1 },
        { key: 'midnight', angle: 0, priority: 2 },
      ],
      { minDegrees: 12 },
    );
    expect(kept.map((label) => label.key)).toEqual(['midnight']);
  });

  it('keeps every kept label at least the minimum apart', () => {
    const candidates = Array.from({ length: 40 }, (_, i) => ({
      key: `l${i}`,
      angle: (i * 37) % 360,
      priority: i % 3,
    }));
    const kept = placeRingLabels(candidates, { minDegrees: 20 });
    for (const a of kept) {
      for (const b of kept) {
        if (a !== b) expect(angleDistance(a.angle, b.angle)).toBeGreaterThanOrEqual(20);
      }
    }
  });

  it('drops an hour label the now marker sits on, and only that one', () => {
    expect(ringHourLabels(null).map((l) => l.hour)).toEqual([0, 6, 12, 18]);
    expect(ringHourLabels(angleOf(at(11, 30).getTime(), frame)).map((l) => l.hour)).toEqual([
      0, 6, 18,
    ]);
    expect(ringHourLabels(angleOf(at(23, 50).getTime(), frame)).map((l) => l.hour)).toEqual([
      6, 12, 18,
    ]);
    // Far enough from every hour: all four stay.
    expect(ringHourLabels(angleOf(at(9).getTime(), frame)).map((l) => l.hour)).toEqual([
      0, 6, 12, 18,
    ]);
    // Exactly at the clearance the label stays.
    expect(ringHourLabels(180 - RING_LABEL_CLEARANCE).map((l) => l.hour)).toEqual([0, 6, 12, 18]);
  });
});

describe('ringLegendKeys', () => {
  it('names only what the ring draws, in a fixed order', () => {
    expect(
      ringLegendKeys({
        spans: [
          { id: 'n', kind: 'nap', from: 1, to: 2 },
          { id: 'w', kind: 'waking', from: 3, to: 4 },
          { id: 'g', kind: 'night', from: 0, to: 1 },
        ],
        windows: [{ id: 'window-0', from: 5, to: 6, earliest: '', latest: '' }],
      }),
    ).toEqual(['night', 'nap', 'waking', 'window', 'now']);
  });
});
