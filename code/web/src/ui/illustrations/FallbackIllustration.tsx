import { CategoryIcon } from '../CategoryIcon';
import type { IconSize } from '../Icon';
import type { IconName } from '../icons';
import type { CategoryName } from '../../theme/tokens';
import type { IllustrationProps } from './IllustrationFrame';

export interface FallbackIllustrationProps extends IllustrationProps {
  /** Icon drawn in the tile (default: the generic event glyph). */
  icon?: IconName;
  category?: CategoryName;
}

/** Largest icon that leaves a comfortable margin in a `size` px circle. */
function iconSizeFor(size: number): IconSize {
  if (size <= 28) return 16;
  if (size <= 40) return 20;
  if (size <= 56) return 24;
  if (size <= 72) return 32;
  return 40;
}

/**
 * What a key without an illustration (a custom event type, an unknown stored key) shows: the
 * outline icon in its tinted category circle, at the illustration's size. It follows the app's
 * scheme through CSS variables, so `scheme`, `glow` and `className` do not apply.
 */
export function FallbackIllustration({
  size = 48,
  title,
  icon = 'event',
  category = 'custom',
}: FallbackIllustrationProps) {
  return (
    <CategoryIcon
      name={icon}
      category={category}
      size={iconSizeFor(size)}
      label={title}
      sx={{ width: size, height: size }}
    />
  );
}
