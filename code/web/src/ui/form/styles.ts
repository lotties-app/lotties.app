import type { Theme } from '@mui/material';
import { RADIUS } from '../../theme/tokens';

/** Palette entries as CSS variables when available (they follow the active scheme). */
export const palette = (theme: Theme) => (theme.vars ?? theme).palette;

/** Minimum size of a touch target in the form controls (docs/design/03-interaction.md section 6). */
export const CONTROL_HEIGHT = 48;

export const focusRing = (theme: Theme) => `2px solid ${palette(theme).primary.main}`;

/** The filled input surface: raised tone, 14px radius, 48px high. Error and focus are rings. */
export const filledSurface = (theme: Theme, invalid = false) => ({
  minHeight: CONTROL_HEIGHT,
  borderRadius: `${RADIUS.input}px`,
  backgroundColor: palette(theme).surfaceRaised,
  color: palette(theme).text.primary,
  boxShadow: invalid ? `0 0 0 2px ${palette(theme).error.main}` : 'none',
});

/**
 * Spread after `font: 'inherit'` on a text input, textarea or select: iOS zooms the page into a
 * focused field under 16 px, so touch screens get a 16 px floor (a larger text size still wins
 * through `1rem`). The theme does the same for MUI fields (docs/design/30-mobile-overflow-audit.md).
 */
export const TOUCH_FIELD_FONT = {
  '@media (pointer: coarse)': { fontSize: 'max(16px, 1rem)' },
} as const;

/** Shared look of a pressable option (segment, chip, quick value) that is not selected. */
export const optionBase = (theme: Theme) => ({
  appearance: 'none' as const,
  border: 0,
  font: 'inherit',
  color: palette(theme).text.secondary,
  cursor: 'pointer',
  '&:focus-visible': { outline: focusRing(theme), outlineOffset: 2 },
  '&:disabled, &[aria-disabled="true"]': { opacity: 0.5, cursor: 'not-allowed' },
  '@media (forced-colors: active)': { border: '1px solid ButtonText' },
});

/** Selected option: an inset accent ring, the strong text colour and a heavier weight. */
export const selectedOption = (theme: Theme) => ({
  color: palette(theme).text.primary,
  fontWeight: 600,
  boxShadow: `inset 0 0 0 1.5px ${palette(theme).primary.main}`,
  '@media (forced-colors: active)': { border: '2px solid Highlight' },
});
