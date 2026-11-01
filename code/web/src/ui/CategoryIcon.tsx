import type { SxProps, Theme } from '@mui/material';
import { Box } from '@mui/material';
import type { CategoryName } from '../theme/tokens';
import { Icon, type IconSize } from './Icon';
import type { IconName } from './icons';

/** Stamp (circle) size in px for each icon size: 44/40/36 in the visual identity. */
const STAMP: Record<IconSize, number> = { 16: 28, 20: 36, 24: 44, 32: 56, 40: 64 };

export interface CategoryIconProps {
  name: IconName;
  category: CategoryName;
  size?: IconSize;
  label?: string;
  sx?: SxProps<Theme>;
}

/**
 * An icon inside a circle tinted with the category's token pair (`category.<name>.bg` / `.fg`,
 * AA by `tokens.test.ts`). Follows the active scheme (light, dark, night) through CSS variables.
 */
export function CategoryIcon({ name, category, size = 24, label, sx }: CategoryIconProps) {
  return (
    <Box
      sx={[
        (theme) => {
          const pair = (theme.vars ?? theme).palette.category[category];
          return {
            flexShrink: 0,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: STAMP[size],
            height: STAMP[size],
            borderRadius: '50%',
            backgroundColor: pair.bg,
            color: pair.fg,
          };
        },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    >
      <Icon name={name} size={size} label={label} />
    </Box>
  );
}
