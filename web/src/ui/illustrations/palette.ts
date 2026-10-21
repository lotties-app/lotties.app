/*
 * Original illustrations of Lotties, by the project contributors, licensed under the project
 * licence (AGPL-3.0-or-later). See docs/design/ILLUSTRATIONS.md.
 *
 * Illustration colours, derived from the design tokens (web/src/theme/tokens.ts) so they follow the
 * category pairs of every scheme. A "tone" is the four steps one material needs: `hi` (lit,
 * top-left), `mid` (body), `lo` (shade, bottom-right) and `deep` (small details drawn on top).
 *
 * - dark: the category icon colour (`fg`) is the body; highlights lean to white, shade to the light
 *   scheme's ink of the same hue.
 * - light: the category colours slightly deeper than mid-tone (30% from the ink towards the pastel,
 *   25% more chroma), so the body holds 3:1 on the pale tile; shade is the ink itself.
 * - night: one warm tone only, lower chroma, blue channel at most 0x78, no gradients. Materials
 *   keep their hierarchy through a role (main, light, dim, cream) instead of their hue.
 */
import { DARK, LIGHT, NIGHT, type CategoryName, type SchemeName } from '../../theme/tokens';
import { mix, saturate } from './color';

/** A category hue, the app accent (terracotta) or cream (paper, milk, labels, eye whites). */
export type Hue = CategoryName | 'accent' | 'cream';

/** Role of a material in the night scheme, where every hue collapses to one warm tone. */
export type NightRole = 'main' | 'light' | 'dim' | 'cream';

export interface Tone {
  hi: string;
  mid: string;
  lo: string;
  deep: string;
}

const WHITE = '#ffffff';
const BLACK = '#000000';
/** Brightest night colour: warm, blue channel 0x78. */
const NIGHT_PEAK = '#e8b878';

function pair(hue: Exclude<Hue, 'cream'>): readonly [light: string, dark: string] {
  if (hue === 'accent') return [LIGHT.accent, DARK.accent];
  return [LIGHT.category[hue].fg, DARK.category[hue].fg];
}

function lightTone(hue: Hue, lift: number): Tone {
  if (hue === 'cream') {
    return {
      hi: WHITE,
      mid: LIGHT.surface,
      lo: mix(LIGHT.hairline, LIGHT.textMuted, 0.35),
      deep: LIGHT.text,
    };
  }
  const [ink, pastel] = pair(hue);
  const mid = mix(saturate(mix(ink, pastel, 0.3), 0.25), pastel, lift);
  return {
    hi: mix(mid, pastel, 0.68),
    mid,
    lo: mix(ink, mid, lift),
    deep: mix(ink, BLACK, 0.35),
  };
}

function darkTone(hue: Hue): Tone {
  if (hue === 'cream') {
    return {
      hi: mix(DARK.text, WHITE, 0.6),
      mid: DARK.text,
      lo: mix(DARK.text, DARK.textMuted, 0.65),
      deep: LIGHT.text,
    };
  }
  const [ink, pastel] = pair(hue);
  return {
    hi: mix(pastel, WHITE, 0.55),
    mid: pastel,
    lo: mix(pastel, ink, 0.5),
    deep: mix(ink, BLACK, 0.4),
  };
}

const NIGHT_FG = NIGHT.category.sleep.fg;

const NIGHT_TONES: Record<NightRole, Tone> = {
  main: {
    hi: NIGHT_FG,
    mid: mix(NIGHT_FG, NIGHT.surface, 0.26),
    lo: mix(NIGHT_FG, NIGHT.surface, 0.5),
    deep: NIGHT.surfaceRaised,
  },
  light: {
    hi: mix(NIGHT.text, NIGHT_PEAK, 0.55),
    mid: NIGHT.text,
    lo: mix(NIGHT_FG, NIGHT.surface, 0.3),
    deep: NIGHT.surfaceRaised,
  },
  dim: {
    hi: mix(NIGHT_FG, NIGHT.surface, 0.3),
    mid: mix(NIGHT_FG, NIGHT.surface, 0.52),
    lo: mix(NIGHT_FG, NIGHT.surface, 0.66),
    deep: NIGHT.surface,
  },
  cream: {
    hi: NIGHT_PEAK,
    mid: mix(NIGHT.text, NIGHT_PEAK, 0.4),
    lo: mix(NIGHT_FG, NIGHT.surface, 0.3),
    deep: NIGHT.background,
  },
};

const cache = new Map<string, Tone>();

/**
 * The tone of `hue` in `scheme`; in night the `role` decides (every hue is the same warm tone).
 * `lift` (0..1, light scheme only) moves a secondary material towards the pastel of its hue, for
 * parts that do not carry the silhouette (food, bubbles): brighter, but no longer 3:1 on the tile.
 */
export function tone(scheme: SchemeName, hue: Hue, role: NightRole = 'main', lift = 0): Tone {
  if (scheme === 'night') return NIGHT_TONES[role];
  const key = `${scheme}:${hue}:${lift}`;
  let found = cache.get(key);
  if (!found) {
    found = scheme === 'light' ? lightTone(hue, lift) : darkTone(hue);
    cache.set(key, found);
  }
  return found;
}
