// The one place that may import MUI's Snackbar (eslint.config.js no-restricted-imports).
import { Snackbar, type SnackbarProps } from '@mui/material';
import type { CSSProperties } from 'react';
import { STACK_OFFSET_VAR, useSnackbarStack } from './snackbarStack';

export type AppSnackbarProps = Omit<SnackbarProps, 'ref'>;

/**
 * Every snackbar of the app. Its bottom offset comes from the theme (`MuiSnackbar` override:
 * the shared `TOAST_BOTTOM`, above the bottom dock and the safe-area inset, on every width), and it
 * joins the shared stack so two notices open together sit one above the other.
 */
export function AppSnackbar({ open = false, style, ...props }: AppSnackbarProps) {
  const [attach, offset] = useSnackbarStack(open);
  const stacked = { ...style, [STACK_OFFSET_VAR]: `${offset}px` } as CSSProperties;
  return <Snackbar {...props} open={open} ref={attach} style={stacked} />;
}
