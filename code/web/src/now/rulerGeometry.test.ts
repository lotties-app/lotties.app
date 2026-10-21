import { describe, expect, it } from 'vitest';
import { rulerGeometry } from './rulerGeometry';

const at = (h: number, m = 0) => new Date(2026, 9, 21, h, m);

describe('rulerGeometry', () => {
  it('puts now and the nap window on the bar, with room after the window', () => {
    const g = rulerGeometry({
      since: at(12, 20).toISOString(),
      now: at(14, 12),
      window: { earliest: at(14, 5).toISOString(), latest: at(14, 35).toISOString() },
    });
    // From 12:20 to 15:05 (window end + 30 min): 165 minutes.
    expect(g.start).toBe(at(12, 20).getTime());
    expect(g.end).toBe(at(15, 5).getTime());
    expect(g.nowPercent).toBeCloseTo((112 / 165) * 100, 5);
    expect(g.band?.left).toBeCloseTo((105 / 165) * 100, 5);
    expect(g.band?.right).toBeCloseTo((135 / 165) * 100, 5);
  });

  it('spans at least two hours, and works without a window', () => {
    const g = rulerGeometry({ since: at(14, 0).toISOString(), now: at(14, 10) });
    expect(g.end - g.start).toBe(2 * 60 * 60_000);
    expect(g.band).toBeNull();
    expect(g.nowPercent).toBeCloseTo((10 / 120) * 100, 5);
  });

  it('keeps now inside the bar when the baby has been awake longer than the window', () => {
    const g = rulerGeometry({
      since: at(8, 0).toISOString(),
      now: at(14, 0),
      window: { earliest: at(10, 0).toISOString(), latest: at(10, 30).toISOString() },
    });
    expect(g.nowPercent).toBeLessThan(100);
    expect(g.nowPercent).toBeGreaterThan(90);
    expect(g.band?.left).toBeGreaterThanOrEqual(0);
  });

  it('clamps a window before waking up and a clock before the wake time', () => {
    const g = rulerGeometry({
      since: at(14, 0).toISOString(),
      now: at(13, 50),
      window: { earliest: at(13, 0).toISOString(), latest: at(13, 30).toISOString() },
    });
    expect(g.nowPercent).toBe(0);
    expect(g.band).toEqual({ left: 0, right: 0 });
  });
});
