import { describe, expect, it } from 'vitest';
import { layoutLane, type LaneSlot } from './upcomingLane';

const items = (...positions: number[]) =>
  positions.map((pos, index) => ({ key: `k${index}`, pos }));
const places = (slots: LaneSlot[]) =>
  slots.map((slot) =>
    slot.kind === 'single' ? slot.pos : `cluster(${slot.keys.length})@${slot.pos}`,
  );

describe('layoutLane', () => {
  it('keeps markers that do not overlap where they are', () => {
    expect(places(layoutLane(items(10, 40, 90), 20, [0, 360]))).toEqual([10, 40, 90]);
  });

  it('spreads two or three close markers around their middle', () => {
    expect(places(layoutLane(items(100, 104), 20, [0, 360]))).toEqual([92, 112]);
    expect(places(layoutLane(items(100, 102, 104), 20, [0, 360]))).toEqual([82, 102, 122]);
  });

  it('clusters more than three close markers into one', () => {
    const slots = layoutLane(items(200, 201, 202, 203), 20, [0, 360]);
    expect(slots).toEqual([{ kind: 'cluster', keys: ['k0', 'k1', 'k2', 'k3'], pos: 201.5 }]);
  });

  it('pushes neighbours apart as little as possible, clusters only a run of more than three', () => {
    // 100 and 104 overlap, 125 does not: all three end up 20 apart around their mean.
    const slots = layoutLane(items(100, 104, 125), 20, [0, 360]);
    const positions = places(slots) as number[];
    expect(positions).toHaveLength(3);
    expect(positions[1] - positions[0]).toBeCloseTo(20);
    expect(positions[2] - positions[1]).toBeCloseTo(20);
    expect(layoutLane(items(100, 104, 110, 125), 20, [0, 360])).toMatchObject([
      { kind: 'cluster', keys: ['k0', 'k1', 'k2', 'k3'] },
    ]);
    // A busy afternoon: two runs of two and three, no cluster, never closer than the gap.
    const busy = layoutLane(items(242.5, 250, 277.5, 285, 300), 20, [210, 360]);
    expect(busy.every((slot) => slot.kind === 'single')).toBe(true);
    const spread = places(busy) as number[];
    spread.slice(1).forEach((pos, index) => expect(pos - spread[index]).toBeCloseTo(20));
  });

  it('shares a lane too short for the gap evenly', () => {
    expect(places(layoutLane(items(350, 352, 355), 20, [340, 360]))).toEqual([340, 350, 360]);
  });

  it('keeps a spread group inside the lane', () => {
    expect(places(layoutLane(items(98, 99), 10, [0, 100]))).toEqual([90, 100]);
    expect(places(layoutLane(items(0, 1, 2), 10, [0, 100]))).toEqual([0, 10, 20]);
  });

  it('is empty without markers', () => {
    expect(layoutLane([], 20, [0, 360])).toEqual([]);
  });
});
