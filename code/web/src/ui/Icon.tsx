import type { Ref } from 'react';
import { Box, type SxProps, type Theme } from '@mui/material';
import { FALLBACK_ICON, ICON_COMPONENTS, type IconName } from './icons';

/** Size grid in px: 16 inline and dense, 20 fields and chips, 24 default, 32/40 empty states. */
export type IconSize = 16 | 20 | 24 | 32 | 40;

/** Stroke width in the 24 px design grid (docs/design/02-visual-identity.md: 1.5 px). */
export const ICON_STROKE = 1.5;

const IMAGE_ROLE = 'img';

export interface IconProps {
  name: IconName;
  size?: IconSize;
  /**
   * Accessible name. Without it the icon is decorative (`aria-hidden`); with it the icon is an
   * image with that name (e.g. a status glyph that has no text next to it).
   */
  label?: string;
  sx?: SxProps<Theme>;
  /** For wrappers (MUI passes one to its `IconComponent`s). */
  className?: string;
  ref?: Ref<SVGSVGElement>;
}

/**
 * The single icon API of the app: a Tabler outline icon in `currentColor` (colour it through the
 * parent's `color` or `sx`), stroke 1.5, sized on the 16/20/24 grid. Unknown names fall back to a
 * neutral glyph so a bad stored key never breaks a screen.
 */
export function Icon({ name, size = 24, label, sx, className, ref }: IconProps) {
  const Component = Object.hasOwn(ICON_COMPONENTS, name)
    ? ICON_COMPONENTS[name]
    : ICON_COMPONENTS[FALLBACK_ICON];
  return (
    <Box
      component={Component}
      ref={ref}
      size={size}
      stroke={ICON_STROKE}
      className={className}
      data-icon={name}
      role={label ? IMAGE_ROLE : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      sx={[{ flexShrink: 0, display: 'inline-block' }, ...(Array.isArray(sx) ? sx : [sx])]}
    />
  );
}
