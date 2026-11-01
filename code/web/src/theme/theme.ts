import { createColorScheme, createTheme, type Theme } from '@mui/material/styles';
import type { Localization } from '@mui/material/locale';
import {
  DARK,
  LIGHT,
  NIGHT,
  RADIUS,
  type CategoryColors,
  type CategoryName,
  type ChartColors,
  type SchemeTokens,
} from './tokens';
import { ALERT_ICON_MAPPING } from '../ui/alertIconMapping';
import { SelectArrowIcon } from '../ui/muiIcons';

/** The user's choice. `system` follows the OS and falls back to dark when it has no preference. */
export type ThemeMode = 'system' | 'dark' | 'light';

declare module '@mui/material/styles' {
  /** The night-feed scheme is a third MUI colour scheme (selector: `data-night` on <html>). */
  interface ColorSchemeOverrides {
    night: true;
  }
  interface Palette {
    surfaceRaised: string;
    hairline: string;
    textMuted: string;
    accent: string;
    onAccent: string;
    selection: string;
    onSelection: string;
    ink2: string;
    category: Record<CategoryName, CategoryColors>;
    chart: ChartColors;
    cardShadow: string;
    fabShadow: string;
    navShadow: string;
    scrim: string;
    grainOpacity: number;
    scrollThumb: string;
    scrollThumbHover: string;
  }
  interface PaletteOptions {
    surfaceRaised?: string;
    hairline?: string;
    textMuted?: string;
    accent?: string;
    onAccent?: string;
    selection?: string;
    onSelection?: string;
    ink2?: string;
    category?: Record<CategoryName, CategoryColors>;
    chart?: ChartColors;
    cardShadow?: string;
    fabShadow?: string;
    navShadow?: string;
    scrim?: string;
    grainOpacity?: number;
    scrollThumb?: string;
    scrollThumbHover?: string;
  }
  interface TypographyVariants {
    /** Hero value: serif 48/400 with tabular lining figures. */
    hero: React.CSSProperties;
    /** Big amount / timer value: serif 64/400. */
    amount: React.CSSProperties;
    /** Serif stack used by the display and numeric roles. */
    fontFamilyDisplay: string;
  }
  interface TypographyVariantsOptions {
    hero?: React.CSSProperties;
    amount?: React.CSSProperties;
    fontFamilyDisplay?: string;
  }
}

declare module '@mui/material/Typography' {
  interface TypographyPropsVariantOverrides {
    hero: true;
    amount: true;
  }
}

const FONT_STACK =
  'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif';

/** Fraunces (self-hosted variable subset, src/theme/fonts.css) with system serif fallbacks. */
export const FONT_DISPLAY =
  '"Fraunces Variable", "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif';

/** Tabular lining figures: times and amounts line up and do not jitter. */
const NUMERIC = { fontFeatureSettings: '"tnum" 1, "lnum" 1', fontVariantNumeric: 'tabular-nums' };

/** Motion tokens (docs/design/02-visual-identity.md section 8): no overshoot. */
const EASING = 'cubic-bezier(0.2, 0, 0, 1)';

function paletteFor(mode: 'light' | 'dark', t: SchemeTokens) {
  return {
    mode,
    primary: { main: t.accent, contrastText: t.onAccent },
    secondary: { main: t.ink2 },
    success: { main: t.success, contrastText: t.onSuccess },
    warning: { main: t.warning, contrastText: t.onWarning },
    error: { main: t.error, contrastText: t.onError },
    info: { main: t.info, contrastText: t.onInfo },
    background: { default: t.background, paper: t.surface },
    text: { primary: t.text, secondary: t.textMuted },
    divider: t.hairline,
    surfaceRaised: t.surfaceRaised,
    hairline: t.hairline,
    textMuted: t.textMuted,
    accent: t.accent,
    onAccent: t.onAccent,
    selection: t.selection,
    onSelection: t.onSelection,
    ink2: t.ink2,
    category: t.category,
    chart: t.chart,
    cardShadow: t.cardShadow,
    fabShadow: t.fabShadow,
    navShadow: t.navShadow,
    scrim: t.scrim,
    grainOpacity: t.grainOpacity,
    scrollThumb: t.scrollThumb,
    scrollThumbHover: t.scrollThumbHover,
  };
}

/** Scrollbar gutter and visible thumb width, in px. */
const SCROLLBAR_SIZE = 12;
const SCROLLBAR_THUMB = 8;
/** Gap between the bar and the ends of its scroll area. */
const SCROLLBAR_INSET = 4;

/**
 * Themed scrollbars (docs/DESIGN.md "Scrollbars"): a slim pill thumb in the scheme's muted ink on a
 * transparent track, inset so it floats like the cards, warming to the accent on hover. Only with
 * a fine pointer: touch screens keep their own overlay bars. WebKit and Blink draw the pill from
 * `::-webkit-scrollbar` (the standard properties would switch it off there), the others get the
 * standard `scrollbar-width` / `scrollbar-color` with the same tokens. Sheets and dialogs keep the
 * bar clear of their rounded corners. The colours are the scheme's CSS variables (`theme.vars`), so
 * light, dark and night switch with the scheme.
 */
export const SCROLLBAR_VARS = {
  thumb: 'var(--mui-palette-scrollThumb)',
  hover: 'var(--mui-palette-scrollThumbHover)',
} as const;

function scrollbarStyles({ thumb, hover }: typeof SCROLLBAR_VARS) {
  return {
    '@media (pointer: fine)': {
      '@supports not selector(::-webkit-scrollbar)': {
        '*': { scrollbarWidth: 'thin', scrollbarColor: `${thumb} transparent` },
      },
      '*::-webkit-scrollbar': { width: SCROLLBAR_SIZE, height: SCROLLBAR_SIZE },
      '*::-webkit-scrollbar-track, *::-webkit-scrollbar-corner': { background: 'transparent' },
      '*::-webkit-scrollbar-track': { marginBlock: SCROLLBAR_INSET },
      '*::-webkit-scrollbar-thumb': {
        backgroundColor: thumb,
        borderRadius: RADIUS.pill,
        // The transparent border insets the 8 px pill inside the 12 px gutter.
        border: `${(SCROLLBAR_SIZE - SCROLLBAR_THUMB) / 2}px solid transparent`,
        backgroundClip: 'padding-box',
        minHeight: 40,
      },
      '*::-webkit-scrollbar-thumb:hover, *::-webkit-scrollbar-thumb:active': {
        backgroundColor: hover,
      },
      '*::-webkit-scrollbar-button': { display: 'none', width: 0, height: 0 },
      '.MuiDrawer-paper::-webkit-scrollbar-track, .MuiDialog-paper::-webkit-scrollbar-track': {
        marginBlock: RADIUS.sheetTop,
      },
    },
  };
}

export const SCROLLBAR_STYLES = scrollbarStyles(SCROLLBAR_VARS);

/** Palette entries (CSS variables when available, plain values otherwise). */
function colors(theme: Theme) {
  return (theme.vars ?? theme).palette;
}

const FOCUS_RING = (theme: Theme) => `2px solid ${colors(theme).primary.main}`;

/** Status colours borrow the category pairs: those are already contrast-checked on their tint. */
const STATUS_CATEGORY = {
  success: 'feeding',
  warning: 'diaper',
  error: 'health',
  info: 'sleep',
} as const satisfies Record<string, CategoryName>;
type Status = keyof typeof STATUS_CATEGORY;
const isStatus = (value: unknown): value is Status =>
  typeof value === 'string' && value in STATUS_CATEGORY;

/**
 * Space the floating navigation pill (64 px, 12 px above the edge) covers, plus a gap: focused or
 * scrolled-to elements stop above it (WCAG 2.4.11 Focus not obscured, review 05 M11).
 */
export const BOTTOM_NAV_SCROLL_PADDING = 'calc(104px + env(safe-area-inset-bottom))';

/** Inputs: filled, 48px, 14px radius. Labels are always shrunk, with room above the value. */
const FILLED_FIELD_PADDING = { paddingTop: 21, paddingBottom: 6 };

export function buildTheme(localization?: Localization) {
  return createTheme(
    {
      cssVariables: { colorSchemeSelector: 'data' },
      colorSchemes: {
        light: { palette: paletteFor('light', LIGHT) },
        dark: { palette: paletteFor('dark', DARK) },
        // Night feed is built on the dark palette mode; `data-night` replaces `data-dark`. MUI only
        // completes the light, dark and default schemes itself, so this one is created explicitly.
        night: createColorScheme({ palette: paletteFor('dark', NIGHT) }),
      },
      shape: { borderRadius: RADIUS.tile },
      typography: {
        fontFamily: FONT_STACK,
        fontFamilyDisplay: FONT_DISPLAY,
        hero: {
          fontFamily: FONT_DISPLAY,
          fontSize: '3rem',
          fontWeight: 400,
          lineHeight: 1.05,
          letterSpacing: '-0.01em',
          ...NUMERIC,
        },
        amount: {
          fontFamily: FONT_DISPLAY,
          fontSize: '4rem',
          fontWeight: 400,
          lineHeight: 1,
          ...NUMERIC,
        },
        h4: { fontFamily: FONT_DISPLAY, fontSize: '2rem', fontWeight: 400, lineHeight: 1.1 },
        h5: { fontFamily: FONT_DISPLAY, fontSize: '1.375rem', fontWeight: 600, lineHeight: 1.2 },
        h6: { fontSize: '0.9375rem', fontWeight: 600, lineHeight: 1.4 },
        subtitle1: { fontSize: '0.9375rem', fontWeight: 600, lineHeight: 1.4 },
        subtitle2: { fontSize: '0.875rem', fontWeight: 600, lineHeight: 1.4 },
        body1: { fontSize: '0.9375rem', fontWeight: 400, lineHeight: 1.5 },
        body2: { fontSize: '0.875rem', fontWeight: 400, lineHeight: 1.5 },
        caption: { fontSize: '0.75rem', fontWeight: 400, lineHeight: 1.4 },
        overline: {
          fontSize: '0.75rem',
          fontWeight: 650,
          lineHeight: 1.4,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
        },
        button: { fontSize: '0.875rem', fontWeight: 600, textTransform: 'none' },
      },
      transitions: {
        duration: { shortest: 150, shorter: 180, short: 200, standard: 200, complex: 280 },
        easing: { easeInOut: EASING, easeOut: EASING, easeIn: EASING },
      },
      components: {
        MuiCssBaseline: {
          styleOverrides: {
            ...SCROLLBAR_STYLES,
            // Mobile (docs/design/30-mobile-overflow-audit.md): no text inflation on rotation; the page keeps
            // the browser's pull-to-refresh (only sheets stop scroll chaining, below). Pinch zoom always stays (WCAG 1.4.4).
            html: {
              scrollPaddingBottom: BOTTOM_NAV_SCROLL_PADDING,
              WebkitTextSizeAdjust: '100%',
              textSizeAdjust: '100%',
            },
            // A word longer than the line (a name, a long Portuguese word at large text) breaks
            // instead of pushing the page sideways; headings also let their flex row shrink them.
            body: { ...NUMERIC, overflowWrap: 'break-word' },
            'h1, h2, h3, h4, h5, h6': { overflowWrap: 'anywhere' },
            // Sheets, dialogs and popovers (and the scrolling parts inside them) keep their scroll:
            // reaching their end never scrolls or bounces the page behind.
            '.MuiDrawer-paper, .MuiDrawer-paper *, .MuiDialog-paper, .MuiDialog-paper *, .MuiPopover-paper, .MuiPopover-paper *':
              { overscrollBehavior: 'contain' },
            // Removes the double-tap zoom delay on controls; pinch zoom and panning stay.
            'a, button, input, select, textarea, label, summary, [role="button"], [role="tab"], [role="switch"]':
              { touchAction: 'manipulation' },
            // iOS zooms the page into a focused field under 16 px: text fields get a 16 px floor on
            // touch screens (the user's larger text size still wins through `1rem`). `html` makes
            // the rule outrank the component's own class.
            '@media (pointer: coarse)': {
              'html input, html select, html textarea, html .MuiInputBase-root, html .MuiPickersInputBase-root':
                { fontSize: 'max(16px, 1rem)' },
            },
            // Reduced motion and the night view keep opacity changes only.
            '@media (prefers-reduced-motion: reduce)': {
              '*, *::before, *::after': {
                animation: 'none !important',
                transitionProperty: 'opacity !important',
                transitionDuration: '0.12s !important',
                scrollBehavior: 'auto !important',
              },
            },
            '[data-night] *, [data-night] *::before, [data-night] *::after': {
              animation: 'none !important',
              transitionProperty: 'opacity !important',
              transitionDuration: '0.12s !important',
              scrollBehavior: 'auto !important',
            },
            '[data-night]': { colorScheme: 'dark' },
          },
        },
        MuiButtonBase: {
          styleOverrides: {
            root: ({ theme }) => ({
              '&.Mui-focusVisible': { outline: FOCUS_RING(theme), outlineOffset: 2 },
            }),
          },
        },
        MuiIconButton: {
          styleOverrides: { root: { minWidth: 44, minHeight: 44 } },
        },
        MuiButton: {
          defaultProps: { disableElevation: true },
          styleOverrides: {
            root: { minHeight: 44, borderRadius: RADIUS.button },
            sizeLarge: { minHeight: 54, fontSize: '1rem' },
            contained: { boxShadow: 'none', paddingInline: 20 },
            outlined: ({ theme }) => ({ borderColor: colors(theme).hairline }),
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
              boxShadow: colors(theme).cardShadow,
            }),
          },
        },
        MuiAccordion: {
          styleOverrides: {
            root: ({ theme }) => ({
              borderRadius: RADIUS.card,
              boxShadow: colors(theme).cardShadow,
              '&::before': { display: 'none' },
              '&:first-of-type, &:last-of-type': { borderRadius: RADIUS.card },
            }),
          },
        },
        MuiChip: {
          styleOverrides: {
            root: ({ theme, ownerState }) => ({
              borderRadius: RADIUS.pill,
              fontWeight: 500,
              // In a row a chip may shrink (its label ends in "…") instead of pushing the row wider.
              minWidth: 0,
              ...(ownerState.variant === 'filled' &&
                (ownerState.color === 'default' || ownerState.color === undefined) && {
                  backgroundColor: colors(theme).surfaceRaised,
                  color: colors(theme).text.primary,
                }),
              ...(ownerState.variant === 'filled' &&
                isStatus(ownerState.color) && {
                  backgroundColor: colors(theme).category[STATUS_CATEGORY[ownerState.color]].bg,
                  color: colors(theme).category[STATUS_CATEGORY[ownerState.color]].fg,
                }),
              ...(ownerState.variant === 'outlined' &&
                (ownerState.color === 'default' || ownerState.color === undefined) && {
                  borderColor: colors(theme).hairline,
                }),
            }),
            label: { fontSize: '0.75rem' },
          },
        },
        MuiDrawer: {
          styleOverrides: {
            paper: ({ theme }) => ({
              '&.MuiDrawer-paperAnchorBottom': {
                borderTopLeftRadius: RADIUS.sheetTop,
                borderTopRightRadius: RADIUS.sheetTop,
                maxHeight: '90dvh',
                boxShadow: `0 -1px 0 ${colors(theme).hairline}`,
              },
            }),
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
        MuiBackdrop: {
          styleOverrides: {
            root: ({ theme }) => ({
              '&:not(.MuiBackdrop-invisible)': { backgroundColor: colors(theme).scrim },
            }),
          },
        },
        MuiAlert: {
          defaultProps: { iconMapping: ALERT_ICON_MAPPING },
          styleOverrides: {
            root: ({ theme, ownerState }) => {
              const status = ownerState.color ?? ownerState.severity;
              if (ownerState.variant !== 'standard' || !isStatus(status)) return {};
              const pair = colors(theme).category[STATUS_CATEGORY[status]];
              return {
                borderRadius: RADIUS.input,
                backgroundColor: pair.bg,
                color: pair.fg,
                '& .MuiAlert-icon': { color: pair.fg },
              };
            },
          },
        },
        MuiSnackbarContent: {
          styleOverrides: {
            root: ({ theme }) => ({
              borderRadius: RADIUS.input,
              backgroundColor: colors(theme).selection,
              color: colors(theme).onSelection,
              fontSize: '0.875rem',
            }),
          },
        },
        MuiSelect: { defaultProps: { IconComponent: SelectArrowIcon } },
        MuiTextField: {
          defaultProps: {
            variant: 'filled',
            // Labels never float over the value or clip: always shrunk to the top of the field.
            slotProps: { inputLabel: { shrink: true } },
          },
        },
        MuiInputLabel: {
          defaultProps: { shrink: true },
          styleOverrides: {
            root: ({ theme }) => ({
              color: colors(theme).text.secondary,
              '&.Mui-focused': { color: colors(theme).text.primary },
              '&.Mui-error': { color: colors(theme).error.main },
            }),
          },
        },
        MuiFilledInput: {
          defaultProps: { disableUnderline: true },
          styleOverrides: {
            root: ({ theme }) => ({
              minHeight: 48,
              borderRadius: RADIUS.input,
              backgroundColor: colors(theme).surfaceRaised,
              '&:hover, &.Mui-focused, &.Mui-disabled': {
                backgroundColor: colors(theme).surfaceRaised,
              },
              '&.Mui-focused': { boxShadow: `0 0 0 2px ${colors(theme).primary.main}` },
              '&.Mui-error': { boxShadow: `0 0 0 2px ${colors(theme).error.main}` },
              '&.MuiInputBase-multiline': { padding: '21px 12px 6px' },
            }),
            input: { ...FILLED_FIELD_PADDING, '&.MuiInputBase-inputMultiline': { padding: 0 } },
          },
        },
        MuiOutlinedInput: {
          styleOverrides: {
            root: ({ theme }) => ({
              minHeight: 48,
              borderRadius: RADIUS.input,
              '& .MuiOutlinedInput-notchedOutline': { borderColor: colors(theme).hairline },
            }),
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
              position: 'relative',
              minHeight: 56,
              minWidth: 0,
              color: colors(theme).text.secondary,
              '&.Mui-selected': {
                color: colors(theme).text.primary,
                fontWeight: 600,
                '&::before': {
                  content: '""',
                  position: 'absolute',
                  top: 0,
                  width: 22,
                  height: 3,
                  borderRadius: 2,
                  backgroundColor: colors(theme).primary.main,
                },
              },
            }),
            label: { fontSize: '0.75rem', '&.Mui-selected': { fontSize: '0.75rem' } },
          },
        },
      },
    },
    ...(localization ? [localization] : []),
  );
}
