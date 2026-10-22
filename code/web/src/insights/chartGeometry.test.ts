import { describe, expect, it } from 'vitest';
import {
  BAR_RADIUS,
  HOUR_MS,
  MAX_BAR,
  SEGMENT_GAP,
  bands,
  clampLabel,
  columnPath,
  countAxis,
  hoursAxis,
  labelledColumns,
  nonOverlapping,
  rhythmRowHeight,
  spanRect,
  stackSegments,
} from './chartGeometry';

describe('value axes', () => {
  it('rounds counts to clean steps', () => {
    expect(countAxis(7)).toEqual({ max: 8, ticks: [0, 2, 4, 6, 8] });
    expect(countAxis(9)).toEqual({ max: 10, ticks: [0, 5, 10] });
    expect(countAxis(540)).toEqual({ max: 600, ticks: [0, 200, 400, 600] });
    expect(countAxis(0)).toEqual({ max: 1, ticks: [0, 1] });
  });

  it('steps durations in whole hours', () => {
    expect(hoursAxis(13.5 * HOUR_MS)).toEqual({
      max: 16 * HOUR_MS,
      ticks: [0, 4, 8, 12, 16].map((h) => h * HOUR_MS),
    });
    expect(hoursAxis(0).max).toBe(HOUR_MS);
  });
});

describe('columns', () => {
  it('centres capped columns in equal bands', () => {
    const wide = bands(2, 0, 200);
    expect(wide.map((b) => b.center)).toEqual([50, 150]);
    expect(wide[0].bar).toBe(MAX_BAR);
    const narrow = bands(30, 0, 300);
    expect(narrow[0].bar).toBeCloseTo(6.2);
    expect(bands(0, 0, 100)).toEqual([]);
  });

  it('rounds only the data end and keeps the base square', () => {
    const path = columnPath(10, 20, 50, 100);
    expect(path.startsWith('M10,100 V54')).toBe(true);
    expect(path).toContain(`Q10,50 ${10 + BAR_RADIUS},50`);
    expect(path.endsWith('V100 Z')).toBe(true);
    expect(columnPath(10, 20, 100, 100)).toBe('');
    // A 2-unit column gets a 2-unit radius.
    expect(columnPath(10, 20, 98, 100)).toContain('V100');
    expect(columnPath(10, 20, 98, 100)).toContain('Q10,98 12,98');
  });

  it('stacks segments with a surface gap, skipping empty ones', () => {
    const segments = stackSegments([10, 0, 5], (v) => v * 2, 100);
    expect(segments).toEqual([
      { index: 0, top: 80, bottom: 100, isTop: false },
      { index: 2, top: 70, bottom: 80 - SEGMENT_GAP, isTop: true },
    ]);
    expect(stackSegments([0, 0], (v) => v, 100)).toEqual([]);
    expect(stackSegments([4], (v) => v, 100)).toEqual([
      { index: 0, top: 96, bottom: 100, isTop: true },
    ]);
  });
});

describe('labels and rows', () => {
  it('labels every day of a week, otherwise every 7th counted from today', () => {
    expect(labelledColumns(7)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(labelledColumns(14)).toEqual([6, 13]);
    expect(labelledColumns(30)).toEqual([1, 8, 15, 22, 29]);
  });

  it('drops a label that would touch one with priority', () => {
    const kept = nonOverlapping([
      { index: 29, x: 450, width: 100 },
      { index: 22, x: 350, width: 100 },
      { index: 15, x: 250, width: 100 },
    ]);
    expect(kept.map((label) => label.index)).toEqual([29, 15]);
    expect(
      nonOverlapping([
        { index: 1, x: 0, width: 10 },
        { index: 2, x: 30, width: 10 },
      ]),
    ).toHaveLength(2);
  });

  it('keeps a label inside its bounds', () => {
    expect(clampLabel(5, 40, 0, 200)).toBe(20);
    expect(clampLabel(195, 40, 0, 200)).toBe(180);
    expect(clampLabel(100, 40, 0, 200)).toBe(100);
    expect(clampLabel(10, 400, 0, 200)).toBe(100);
  });

  it('sizes rhythm rows by the range and keeps short spans visible', () => {
    expect([7, 14, 30].map(rhythmRowHeight)).toEqual([22, 16, 10]);
    expect(spanRect(0.25, 0.5, 100, 400)).toEqual({ x: 200, width: 100 });
    expect(spanRect(0.5, 0.5, 0, 400).width).toBe(1.5);
    expect(spanRect(-1, 2, 0, 400)).toEqual({ x: 0, width: 400 });
  });
});
