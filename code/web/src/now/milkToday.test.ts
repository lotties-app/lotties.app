import { describe, expect, it } from 'vitest';
import { formatVolume } from '../units/format';
import type { UnitSystem } from '../units/system';
import { shownMilk } from './milkToday';

const text = (ml: number, system: UnitSystem) => formatVolume(ml, system, 'en');
const number = (shown: string) => Number(shown.replace(/[^\d.]/g, ''));

describe('shownMilk', () => {
  it('keeps the two amounts and leaves what was not drunk', () => {
    expect(shownMilk({ drunkMl: 300, preparedMl: 420 }, 'metric')).toEqual({
      drunkMl: 300,
      preparedMl: 420,
      notDrunkMl: 120,
      drunkShare: 300 / 420,
    });
  });

  it('has nothing not drunk when all was drunk, and a full bar', () => {
    const shown = shownMilk({ drunkMl: 240, preparedMl: 240 }, 'metric');
    expect(shown.notDrunkMl).toBe(0);
    expect(shown.drunkShare).toBe(1);
  });

  it('shows a bottle with nothing drunk as all not drunk, with an empty bar', () => {
    const shown = shownMilk({ drunkMl: 0, preparedMl: 120 }, 'metric');
    expect(shown.notDrunkMl).toBe(120);
    expect(shown.drunkShare).toBe(0);
  });

  it('in fl oz the three shown numbers add up even when the ml difference would round apart', () => {
    for (const [drunk, prepared] of [
      [66, 100],
      [69, 100],
      [100, 150],
      [112, 200],
      [106, 150],
      [61, 120],
      [118, 236],
      [1, 2],
      [29, 30],
    ] as const) {
      const shown = shownMilk({ drunkMl: drunk, preparedMl: prepared }, 'us');
      const d = number(text(shown.drunkMl, 'us'));
      const p = number(text(shown.preparedMl, 'us'));
      const n = shown.notDrunkMl > 0 ? number(text(shown.notDrunkMl, 'us')) : 0;
      expect(Math.round((p - d) * 10) / 10).toBe(n);
    }
  });

  it('shows 3.4 - 2.2 = 1.2 fl oz, where the 34 ml left alone would round to 1.1', () => {
    const shown = shownMilk({ drunkMl: 66, preparedMl: 100 }, 'us');
    expect(text(shown.drunkMl, 'us')).toBe('2.2 fl oz');
    expect(text(shown.preparedMl, 'us')).toBe('3.4 fl oz');
    expect(text(34, 'us')).toBe('1.1 fl oz');
    expect(text(shown.notDrunkMl, 'us')).toBe('1.2 fl oz');
  });

  it('hides a difference that rounds away in fl oz', () => {
    // 29 ml and 30 ml both show as 1 fl oz: nothing shows as not drunk, and the bar is full.
    const shown = shownMilk({ drunkMl: 29, preparedMl: 30 }, 'us');
    expect(text(shown.drunkMl, 'us')).toBe(text(shown.preparedMl, 'us'));
    expect(shown.notDrunkMl).toBe(0);
    expect(shown.drunkShare).toBe(1);
  });

  it('adds up in ml with fractional amounts too (150 - 100.001 = 49.999, not 50)', () => {
    const shown = shownMilk({ drunkMl: 100.0006, preparedMl: 150.0004 }, 'metric');
    expect(text(shown.drunkMl, 'metric')).toBe('100.001 ml');
    expect(text(shown.preparedMl, 'metric')).toBe('150 ml');
    expect(text(shown.notDrunkMl, 'metric')).toBe('49.999 ml');
  });
});
