import type { Theme } from '@mui/material';
import { palette } from '../../ui/form/styles';
import type { RingSpanKind } from '../ringGeometry';

export interface RingLook {
  fill: string;
  stroke: string;
  fillOpacity?: number;
  strokeOpacity?: number;
  /** SVG dash pattern of the edge (the estimates and the windows are dashed, never solid). */
  dash?: string;
}

export type RingLookKind = RingSpanKind | 'window' | 'projected' | 'wake' | 'bedtime';

/**
 * Strength of the upcoming nap windows, by how far out they are: the first upcoming one as strong
 * as the server's window, each further estimate fainter.
 */
export const UPCOMING_STRENGTH = [1, 0.7, 0.5, 0.35] as const;

export const upcomingStrength = (upcoming: number) =>
  UPCOMING_STRENGTH[Math.min(UPCOMING_STRENGTH.length - 1, Math.max(0, upcoming))];

/** A projected nap window `upcoming` steps out: the window's band, faded. */
export function projectedLook(accent: string, upcoming: number): RingLook {
  const strength = upcomingStrength(upcoming);
  return {
    fill: accent,
    stroke: accent,
    fillOpacity: 0.18 * strength,
    strokeOpacity: strength,
    dash: '4 3',
  };
}

/**
 * The colours of the ring's marks, shared by the ring, the ruler and the legend so the key always
 * matches: the Day ribbon's sleep blocks (night solid, nap tint with a rim, night waking tint with
 * a rim), the nap window as a soft accent band with a dashed accent edge, the projected naps as
 * the same band one step fainter (`upcomingStrength` fades them further), the likely wake-up as a
 * dotted sleep-coloured tail, and the bedtime window as a dashed band in the night's colour.
 * Tokens only; the night scheme remaps them to its warm tones.
 */
export function ringSwatchColors(theme: Theme): Record<RingLookKind, RingLook> {
  const p = palette(theme);
  return {
    night: { fill: p.category.sleep.fg, stroke: 'none' },
    nap: { fill: p.category.sleep.bg, stroke: p.category.sleep.fg },
    waking: { fill: p.category.nightWaking.bg, stroke: p.category.nightWaking.fg },
    window: { fill: p.primary.main, stroke: p.primary.main, fillOpacity: 0.18, dash: '4 3' },
    // Drawn with `projectedLook` (faded by how far out the nap is); the legend shows a second one.
    projected: projectedLook(p.primary.main, 1),
    wake: { fill: 'none', stroke: p.category.sleep.fg, dash: '1.5 3' },
    bedtime: {
      fill: p.category.sleep.fg,
      stroke: p.category.sleep.fg,
      fillOpacity: 0.12,
      dash: '4 3',
    },
  };
}
