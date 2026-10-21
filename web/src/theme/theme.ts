import { createTheme, type Theme } from '@mui/material/styles';
import type { Localization } from '@mui/material/locale';
import {
  DAY,
  NIGHT,
  RADIUS,
  type CategoryColors,
  type CategoryName,
  type SchemeTokens,
} from './tokens';

/** The user's choice. `system` follows the OS and falls back to dark when it has no preference. */
export type ThemeMode = 'system' | 'dark' | 'light';

declare module '@mui/material/styles' {
  interface Palette {
    surfaceRaised: string;
    hairline: string;
    textMuted: string;
    accent: string;
    accentSoft: string;
    onAccent: string;
    category: Record<CategoryName, CategoryColors>;
  }
  interface PaletteOptions {
    surfaceRaised?: string;
    hairline?: string;
    textMuted?: string;
    accent?: string;
    accentSoft?: string;
    onAccent?: string;
    category?: Record<CategoryName, CategoryColors>;
  }
  interface TypographyVariants {
    /** Hero numbers: 28/500 with tabular numerals. */
    hero: React.CSSProperties;
  }
  interface TypographyVariantsOptions {
    hero?: React.CSSProperties;
  }
}

declare module '@mui/material/Typography' {
  interface TypographyPropsVariantOverrides {
    hero: true;
  }
}

const FONT_STACK =
  'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif';

function paletteFor(mode: 'light' | 'dark', t: SchemeTokens) {
  return {
    mode,
    primary: { main: t.accent, contrastText: t.onAccent },
    secondary: { main: t.accentSoft },
    background: { default: t.background, paper: t.surface },
    text: { primary: t.text, secondary: t.textMuted },
    divider: t.hairline,
    surfaceRaised: t.surfaceRaised,
    hairline: t.hairline,
    textMuted: t.textMuted,
    accent: t.accent,
    accentSoft: t.accentSoft,
    onAccent: t.onAccent,
    category: t.category,
  };
}

/** Palette entries (CSS variables when available, plain values otherwise). */
function colors(theme: Theme) {
  return (theme.vars ?? theme).palette;
}

const FOCUS_RING = (theme: Theme) => `2px solid ${colors(theme).primary.main}`;

const LIGHT_CARD_SHADOW = '0 1px 2px rgba(27, 24, 56, 0.06), 0 4px 14px rgba(27, 24, 56, 0.07)';

export function buildTheme(localization?: Localization) {
  return createTheme(
    {
      cssVariables: { colorSchemeSelector: 'data' },
      colorSchemes: {
        dark: { palette: paletteFor('dark', NIGHT) },
        light: { palette: paletteFor('light', DAY) },
      },
      shape: { borderRadius: RADIUS.tile },
      typography: {
        fontFamily: FONT_STACK,
        h5: { fontSize: '1.25rem', fontWeight: 500, lineHeight: 1.3 },
        h6: { fontSize: '0.9375rem', fontWeight: 500, lineHeight: 1.4 },
        subtitle1: { fontSize: '0.9375rem', fontWeight: 500, lineHeight: 1.4 },
        subtitle2: { fontSize: '0.875rem', fontWeight: 500, lineHeight: 1.4 },
        body1: { fontSize: '0.875rem', fontWeight: 400, lineHeight: 1.5 },
        body2: { fontSize: '0.875rem', fontWeight: 400, lineHeight: 1.5 },
        caption: { fontSize: '0.75rem', fontWeight: 400, lineHeight: 1.4 },
        button: { fontSize: '0.875rem', fontWeight: 500, textTransform: 'none' },
        hero: {
          fontSize: '1.75rem',
          fontWeight: 500,
          lineHeight: 1.2,
          fontVariantNumeric: 'tabular-nums',
        },
      },
      transitions: {
        duration: { shortest: 150, shorter: 175, short: 200, standard: 200 },
        easing: { easeInOut: 'cubic-bezier(0, 0, 0.2, 1)' },
      },
      components: {
        MuiCssBaseline: {
          styleOverrides: {
            body: { fontVariantNumeric: 'normal' },
            '@media (prefers-reduced-motion: reduce)': {
              '*, *::before, *::after': {
                animationDuration: '0.01ms !important',
                animationIterationCount: '1 !important',
                transitionDuration: '0.01ms !important',
                scrollBehavior: 'auto !important',
              },
            },
          },
        },
        MuiButtonBase: {
          styleOverrides: {
            root: ({ theme }) => ({ '&.Mui-focusVisible': { outline: FOCUS_RING(theme) } }),
          },
        },
        MuiIconButton: {
          styleOverrides: { root: { minWidth: 44, minHeight: 44 } },
        },
        MuiButton: {
          styleOverrides: {
            root: { minHeight: 44 },
            contained: { borderRadius: RADIUS.pill, boxShadow: 'none', paddingInline: 20 },
          },
        },
        MuiPaper: {
          styleOverrides: { root: { backgroundImage: 'none' } },
        },
        MuiCard: {
          styleOverrides: {
            root: ({ theme }) => ({
              borderRadius: RADIUS.card,
              border: 'none',
              boxShadow: LIGHT_CARD_SHADOW,
              ...theme.applyStyles('dark', { boxShadow: 'none' }),
            }),
          },
        },
        MuiAccordion: {
          styleOverrides: {
            root: ({ theme }) => ({
              borderRadius: RADIUS.card,
              boxShadow: LIGHT_CARD_SHADOW,
              '&::before': { display: 'none' },
              '&:first-of-type, &:last-of-type': { borderRadius: RADIUS.card },
              ...theme.applyStyles('dark', { boxShadow: 'none' }),
            }),
          },
        },
        MuiChip: {
          styleOverrides: {
            root: { borderRadius: RADIUS.pill, fontWeight: 500 },
            label: { fontSize: '0.75rem' },
          },
        },
        MuiDrawer: {
          styleOverrides: {
            paper: {
              '&.MuiDrawer-paperAnchorBottom': {
                borderTopLeftRadius: RADIUS.sheetTop,
                borderTopRightRadius: RADIUS.sheetTop,
                maxHeight: '90dvh',
              },
            },
          },
        },
        MuiDialog: {
          styleOverrides: {
            paper: {
              borderRadius: RADIUS.sheetTop,
              '&.MuiDialog-paperFullScreen': { borderRadius: 0 },
            },
          },
        },
        MuiBottomNavigation: {
          styleOverrides: {
            root: { backgroundColor: 'transparent', height: 64 },
          },
        },
        MuiBottomNavigationAction: {
          styleOverrides: {
            root: ({ theme }) => ({
              minHeight: 56,
              minWidth: 0,
              color: colors(theme).text.secondary,
              '&.Mui-selected': { color: colors(theme).accentSoft },
            }),
            label: { fontSize: '0.75rem', '&.Mui-selected': { fontSize: '0.75rem' } },
          },
        },
      },
    },
    ...(localization ? [localization] : []),
  );
}
