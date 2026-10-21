import type { CategoryName } from '../../theme/tokens';
import type { IconName } from '../icons';
import { FallbackIllustration } from './FallbackIllustration';
import type { IllustrationProps } from './IllustrationFrame';
import { ILLUSTRATIONS, illustrationName } from './registry';

export interface IllustrationByNameProps extends IllustrationProps {
  /** Preset id, built-in event type key, sleep kind, feeding method or canonical name. */
  name: string;
  /** Icon of the fallback tile when `name` has no illustration (e.g. a custom event type). */
  fallbackIcon?: IconName;
  /** Category of the fallback tile (default `custom`). */
  fallbackCategory?: CategoryName;
}

/**
 * The illustration of a key, coloured from the category tokens of the scheme the app shows (or of
 * `scheme`). Keys without an illustration fall back to the outline icon in its category circle.
 */
export function Illustration({
  name,
  fallbackIcon,
  fallbackCategory,
  ...props
}: IllustrationByNameProps) {
  const known = illustrationName(name);
  if (!known) {
    return <FallbackIllustration {...props} icon={fallbackIcon} category={fallbackCategory} />;
  }
  const Component = ILLUSTRATIONS[known].component;
  return <Component {...props} />;
}
