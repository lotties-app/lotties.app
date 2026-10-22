import type { Theme } from '@mui/material';
import { palette } from '../../ui/form/styles';
import type { RingSpanKind } from '../ringGeometry';

export interface RingLook {
  fill: string;
  stroke: string;
  fillOpacity?: number;
}

/**
 * The colours of the ring's marks, shared by the ring and its legend so the key always matches:
 * the Day ribbon's sleep blocks (night solid, nap tint with a rim, night waking tint with a rim)
 * and the nap window as a soft accent band with an accent edge. Tokens only; the night scheme
 * remaps them to its warm tones.
 */
export function ringSwatchColors(theme: Theme): Record<RingSpanKind | 'window', RingLook> {
  const p = palette(theme);
  return {
    night: { fill: p.category.sleep.fg, stroke: 'none' },
    nap: { fill: p.category.sleep.bg, stroke: p.category.sleep.fg },
    waking: { fill: p.category.nightWaking.bg, stroke: p.category.nightWaking.fg },
    window: { fill: p.primary.main, stroke: p.primary.main, fillOpacity: 0.18 },
  };
}
