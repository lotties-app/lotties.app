/**
 * Design tokens: direction B "Linen and Ink" (docs/design/02-visual-identity.md section 8, docs/design/TOKENS.md).
 * Plain data: `theme.ts` maps them onto MUI palettes (and CSS variables), so components read
 * `theme.vars.palette.*` and never hardcode a colour. Three schemes: `light` (Linen), `dark` (Ink)
 * and `night` (Lamplight, the night-feed scheme).
 */

/** What the OS / the user's choice resolves to. */
export type ResolvedMode = 'light' | 'dark';
/** Every colour scheme the app can show: the resolved mode, or the night-feed scheme on top. */
export type SchemeName = ResolvedMode | 'night';
export const SCHEME_NAMES: readonly SchemeName[] = ['light', 'dark', 'night'];

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

/** Icon-on-tinted-stamp pair: `bg` is the tint, `fg` the stronger tone (AA on the tint). */
export interface CategoryColors {
  bg: string;
  fg: string;
}

/** Chart series colours (graphical objects: 3:1 on the surface; shapes and labels carry meaning too). */
export interface ChartColors {
  night: string;
  nap: string;
  feed: string;
  diaper: string;
  medication: string;
  neutral: string;
}

export interface SchemeTokens {
  background: string;
  surface: string;
  surfaceRaised: string;
  hairline: string;
  text: string;
  textMuted: string;
  /** Primary action fill and accent text (AA as text on every surface). */
  accent: string;
  /** Text/icon colour on top of `accent` (AA). */
  onAccent: string;
  /** Selected chip/segment fill (ink, inverts in dark). */
  selection: string;
  onSelection: string;
  /** Second ink: links, charts, `info`. */
  ink2: string;
  /**
   * Status colours replace MUI's defaults. Each `main` is AA as text on every surface and each
   * `on*` is AA on its `main` (filled chips, buttons).
   */
  success: string;
  onSuccess: string;
  warning: string;
  onWarning: string;
  error: string;
  onError: string;
  info: string;
  onInfo: string;
  category: Record<CategoryName, CategoryColors>;
  chart: ChartColors;
  /** Complete `box-shadow` of cards (hairline edge plus lift in light, none otherwise). */
  cardShadow: string;
  /** Complete `box-shadow` of the raised action button. */
  fabShadow: string;
  /** Modal backdrop. */
  scrim: string;
  /** Paper grain opacity (0 = off). */
  grainOpacity: number;
  /** `theme-color` meta / manifest colour. */
  themeColor: string;
}

const NIGHT_PAIR: CategoryColors = { bg: '#231910', fg: '#c98f52' };

export const LIGHT: SchemeTokens = {
  background: '#f5efe4',
  surface: '#fffcf6',
  surfaceRaised: '#eee6d6',
  hairline: '#e2d8c5',
  text: '#2a251f',
  textMuted: '#6a6054',
  accent: '#a8482a',
  onAccent: '#fffcf6',
  selection: '#2a251f',
  onSelection: '#fffcf6',
  ink2: '#2c4870',
  success: '#375f39',
  onSuccess: '#fffcf6',
  warning: '#6e4e0e',
  onWarning: '#fffcf6',
  error: '#962f28',
  onError: '#fffcf6',
  info: '#2c4870',
  onInfo: '#fffcf6',
  category: {
    sleep: { bg: '#e2e7f0', fg: '#2c4870' },
    feeding: { bg: '#e1eadb', fg: '#375f39' },
    diaper: { bg: '#f2e5c6', fg: '#6e4e0e' },
    health: { bg: '#f4dcd6', fg: '#962f28' },
    care: { bg: '#d9eae6', fg: '#1c5b54' },
    activity: { bg: '#f6e0cf', fg: '#8f3f15' },
    nightWaking: { bg: '#ece0ef', fg: '#6a3478' },
    custom: { bg: '#ebe6dc', fg: '#4f483e' },
  },
  chart: {
    night: '#4c3fb0',
    // Darkened from #9a8ef0 (2.7:1 on the surface) to reach the 3:1 graphical-object floor.
    nap: '#9084ec',
    feed: '#0f8a6e',
    diaper: '#b0700f',
    medication: '#c0449e',
    neutral: '#8a7f70',
  },
  cardShadow:
    'inset 0 0 0 1px #e2d8c5, 0 1px 0 rgba(42, 37, 31, 0.04), 0 6px 18px rgba(90, 60, 30, 0.06)',
  fabShadow: '0 0 0 5px #f5efe4, 0 6px 16px rgba(90, 40, 20, 0.22)',
  scrim: 'rgba(42, 37, 31, 0.34)',
  grainOpacity: 0.07,
  themeColor: '#f5efe4',
};

export const DARK: SchemeTokens = {
  background: '#1b1814',
  surface: '#24201b',
  surfaceRaised: '#2e2a23',
  hairline: '#3b362d',
  text: '#f2eadc',
  textMuted: '#b5aa99',
  accent: '#e58f68',
  onAccent: '#23140c',
  selection: '#f2eadc',
  onSelection: '#1b1814',
  ink2: '#9fb6d6',
  success: '#a9cf9f',
  onSuccess: '#1b1814',
  warning: '#e8c47a',
  onWarning: '#23140c',
  error: '#f0a093',
  onError: '#23140c',
  info: '#9fb6d6',
  onInfo: '#1b1814',
  category: {
    sleep: { bg: '#26303f', fg: '#a9c1e3' },
    feeding: { bg: '#263425', fg: '#a9cf9f' },
    diaper: { bg: '#3a3120', fg: '#e8c47a' },
    health: { bg: '#3d2622', fg: '#f0a093' },
    care: { bg: '#1f3533', fg: '#8fd0c6' },
    activity: { bg: '#3d2a1d', fg: '#f0ae7c' },
    nightWaking: { bg: '#34253a', fg: '#d3b0e0' },
    custom: { bg: '#2d2a25', fg: '#cfc6b6' },
  },
  chart: {
    night: '#b4a9ff',
    nap: '#7c6cf0',
    feed: '#1fa889',
    diaper: '#c98322',
    medication: '#d65fb8',
    neutral: '#8a8071',
  },
  cardShadow: 'none',
  fabShadow: '0 0 0 5px #1b1814, 0 6px 16px rgba(0, 0, 0, 0.35)',
  scrim: 'rgba(8, 6, 4, 0.62)',
  grainOpacity: 0.05,
  themeColor: '#1b1814',
};

/**
 * Night feed ("Lamplight"): near-black, one warm tone, blue channel at most 0x78, text about 45%
 * of the dark scheme's brightness, every category in the same pair (meaning moves to icon shape
 * and label), no shadows, no grain, no motion.
 */
export const NIGHT: SchemeTokens = {
  background: '#0d0906',
  surface: '#150f0a',
  surfaceRaised: '#1d150d',
  hairline: '#2a1f13',
  text: '#d49a5e',
  textMuted: '#a87a4a',
  accent: '#e0913f',
  onAccent: '#1a0f05',
  selection: '#c98f52',
  onSelection: '#1a0f05',
  ink2: '#c98f52',
  success: '#c98f52',
  onSuccess: '#1a0f05',
  warning: '#e0913f',
  onWarning: '#1a0f05',
  error: '#e0913f',
  onError: '#1a0f05',
  info: '#c98f52',
  onInfo: '#1a0f05',
  category: {
    sleep: NIGHT_PAIR,
    feeding: NIGHT_PAIR,
    diaper: NIGHT_PAIR,
    health: NIGHT_PAIR,
    care: NIGHT_PAIR,
    activity: NIGHT_PAIR,
    nightWaking: NIGHT_PAIR,
    custom: NIGHT_PAIR,
  },
  chart: {
    night: '#c98f52',
    nap: '#a87a4a',
    feed: '#c98f52',
    diaper: '#a87a4a',
    medication: '#c98f52',
    neutral: '#8a6a44',
  },
  cardShadow: 'none',
  fabShadow: 'none',
  scrim: 'rgba(0, 0, 0, 0.6)',
  grainOpacity: 0,
  themeColor: '#0d0906',
};

export const SCHEMES: Record<SchemeName, SchemeTokens> = {
  light: LIGHT,
  dark: DARK,
  night: NIGHT,
};

/** `theme-color` meta / manifest colours. */
export const THEME_COLOR: Record<SchemeName, string> = {
  light: LIGHT.themeColor,
  dark: DARK.themeColor,
  night: NIGHT.themeColor,
};

export const RADIUS = {
  card: 20,
  tile: 16,
  stamp: 12,
  button: 16,
  input: 14,
  pill: 999,
  sheetTop: 24,
} as const;

/** Maximum width of the centred content column. */
export const CONTENT_MAX_WIDTH = 480;
