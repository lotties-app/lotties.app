import { describe, expect, it } from 'vitest';
import {
  clusterMarks,
  FALLBACK_WIDTH_PX,
  hourTicks,
  labelFits,
  MIN_MARK_GAP_PX,
  nextFocusIndex,
} from './ribbonGeometry';

const mark = (id: string, hour: number, minute = 0) => ({ id, at: (hour * 60 + minute) / 1440 });

describe('hourTicks', () => {
  it('ticks every hour, labels every third, stronger at 06, 12 and 18', () => {
    const ticks = hourTicks();
    expect(ticks).toHaveLength(24);
    expect(ticks.filter((tick) => tick.labelled).map((tick) => tick.hour)).toEqual([
      0, 3, 6, 9, 12, 15, 18, 21,
    ]);
    expect(ticks.filter((tick) => tick.major).map((tick) => tick.hour)).toEqual([6, 12, 18]);
    expect(ticks[6].at).toBe(0.25);
  });
});

describe('clusterMarks', () => {
  it('keeps marks apart when they do not overlap at the width', () => {
    const clusters = clusterMarks([mark('a', 6), mark('b', 12), mark('c', 18)], 360);
    expect(clusters.map((cluster) => cluster.items.map((item) => item.id))).toEqual([
      ['a'],
      ['b'],
      ['c'],
    ]);
    expect(clusters[1].at).toBe(0.5);
  });

  it('merges close marks into one counted mark, drawn between its first and last', () => {
    // 360 px: an hour is 15 px, so marks 20 minutes apart overlap.
    const clusters = clusterMarks([mark('b', 14, 20), mark('a', 14), mark('c', 20)], 360);
    expect(clusters.map((cluster) => cluster.key)).toEqual(['a|b', 'c']);
    expect(clusters[0].at).toBeCloseTo((14 * 60 + 10) / 1440);
  });

  it('splits the same marks again on a wider ribbon', () => {
    const marks = [mark('a', 14), mark('b', 15)];
    expect(clusterMarks(marks, 360)).toHaveLength(1);
    expect(clusterMarks(marks, 1200)).toHaveLength(2);
  });

  it('leaves every drawn mark at least the minimum gap from the next', () => {
    const marks = Array.from({ length: 40 }, (_, index) => mark(`m${index}`, 0, index * 31));
    for (const width of [300, 358, 600, 900]) {
      const clusters = clusterMarks(marks, width);
      expect(clusters.flatMap((cluster) => cluster.items)).toHaveLength(40);
      for (let index = 1; index < clusters.length; index++) {
        const gap = (clusters[index].at - clusters[index - 1].at) * width;
        expect(gap).toBeGreaterThanOrEqual(MIN_MARK_GAP_PX - 1e-9);
      }
    }
  });

  it('uses the fallback width before the ribbon is measured', () => {
    const marks = [mark('a', 9), mark('b', 10)];
    expect(clusterMarks(marks, 0)).toEqual(clusterMarks(marks, FALLBACK_WIDTH_PX));
  });
});

describe('labelFits', () => {
  it('shows a length inside a stretch only when it has room', () => {
    // A 1h20 nap is 20 px on a phone, 67 px on a desktop.
    expect(labelFits('1h 20m', 80 / 1440, 360)).toBe(false);
    expect(labelFits('1h 20m', 80 / 1440, 1200)).toBe(true);
    expect(labelFits('10h 10m', 0.4, 360)).toBe(true);
  });
});

describe('nextFocusIndex', () => {
  it('moves with the arrows, jumps with Home and End and stops at the ends', () => {
    expect(nextFocusIndex(1, 4, 'ArrowRight')).toBe(2);
    expect(nextFocusIndex(3, 4, 'ArrowRight')).toBe(3);
    expect(nextFocusIndex(0, 4, 'ArrowLeft')).toBe(0);
    expect(nextFocusIndex(2, 4, 'ArrowUp')).toBe(1);
    expect(nextFocusIndex(2, 4, 'Home')).toBe(0);
    expect(nextFocusIndex(0, 4, 'End')).toBe(3);
    expect(nextFocusIndex(0, 4, 'Enter')).toBeNull();
    expect(nextFocusIndex(0, 0, 'ArrowRight')).toBeNull();
  });
});
