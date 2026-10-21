/**
 * Design tokens from docs/DESIGN.md section 1. Plain data: `theme.ts` maps them onto MUI palettes
 * (and CSS variables), so components read `theme.vars.palette.*` and never hardcode a colour.
 */

export type ResolvedMode = 'light' | 'dark';

export const CATEGORY_NAMES = [
  'sleep',
  'feeding',
  'diaper',
  'health',
  'care',
  'activity',
  'nightWaking',
  'custom',
] as const;
export type CategoryName = (typeof CATEGORY_NAMES)[number];

/** Icon-on-tinted-circle pair: `bg` is the tint, `fg` the stronger tone (AA on the tint). */
export interface CategoryColors {
  bg: string;
  fg: string;
}

export interface SchemeTokens {
  background: string;
  surface: string;
  surfaceRaised: string;
  hairline: string;
  text: string;
  textMuted: string;
  accent: string;
  accentSoft: string;
  /** Text/icon colour on top of `accent` (AA). */
  onAccent: string;
  /**
   * Warning tone (e.g. the "Overdue" chip, the offline chip): `main` is AA as text on every surface
   * and `onWarning` is AA on `main`.
   */
  warning: string;
  onWarning: string;
  category: Record<CategoryName, CategoryColors>;
}

export const NIGHT: SchemeTokens = {
  background: '#15132e',
  surface: '#1f1c3f',
  surfaceRaised: '#2a2468',
  hairline: '#2a2652',
  text: '#eceaff',
  textMuted: '#9d99c8',
  // Lightened from #7c6cf0 (4.05:1 as text on surface, review 05 M10) to AA on every surface.
  accent: '#968af6',
  accentSoft: '#c4baff',
  onAccent: '#100e26',
  warning: '#ffb74d',
  onWarning: '#100e26',
  category: {
    sleep: { bg: '#3a2f7a', fg: '#c4baff' },
    feeding: { bg: '#16423f', fg: '#7ee0b8' },
    diaper: { bg: '#4a3322', fg: '#ffc58a' },
    health: { bg: '#4b2a33', fg: '#ff9fb2' },
    care: { bg: '#183f55', fg: '#8fd8ff' },
    activity: { bg: '#4a3d1a', fg: '#ffd77a' },
    nightWaking: { bg: '#4a2f55', fg: '#f0b6ff' },
    custom: { bg: '#2f2c57', fg: '#cfcbee' },
  },
};

export const DAY: SchemeTokens = {
  background: '#f6f5ff',
  surface: '#ffffff',
  surfaceRaised: '#ebe8ff',
  hairline: '#e0ddf5',
  text: '#1b1838',
  textMuted: '#5d5a82',
  accent: '#5b4bd6',
  accentSoft: '#4a3cc0',
  onAccent: '#ffffff',
  // MUI's default #ed6c02 gave white text 3.11:1 (review 05 M10).
  warning: '#a64b00',
  onWarning: '#ffffff',
  category: {
    sleep: { bg: '#e4e0ff', fg: '#3a2f9a' },
    feeding: { bg: '#d3f2e7', fg: '#0d5c4b' },
    diaper: { bg: '#ffe7d0', fg: '#86470a' },
    health: { bg: '#ffdde5', fg: '#a1213d' },
    care: { bg: '#d5ecfa', fg: '#0b5680' },
    activity: { bg: '#fff0c4', fg: '#765100' },
    nightWaking: { bg: '#f3dcfa', fg: '#782a91' },
    custom: { bg: '#ecebf5', fg: '#4a4868' },
  },
};

export const SCHEMES: Record<ResolvedMode, SchemeTokens> = { dark: NIGHT, light: DAY };

/** `theme-color` meta / manifest colours. */
export const THEME_COLOR = { dark: NIGHT.background, light: DAY.background } as const;

export const RADIUS = { card: 18, tile: 16, pill: 999, sheetTop: 24 } as const;

/** Maximum width of the centred content column. */
export const CONTENT_MAX_WIDTH = 480;
