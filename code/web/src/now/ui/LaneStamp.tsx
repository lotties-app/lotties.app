import { Box, useTheme } from '@mui/material';
import { palette } from '../../ui/form/styles';
import { FALLBACK_ICON, ICON_COMPONENTS, type IconName } from '../../ui/icons';
import type { UpcomingConfidence } from '../upcoming';
import { CONFIDENCE_STRENGTH, type UpcomingVisual } from './upcomingVisual';

/** The tabler pictogram at any pixel size (the `Icon` API keeps to its size grid). */
export function Pictogram({
  name,
  size,
  x,
  y,
  color,
}: {
  name: IconName;
  size: number;
  x?: number;
  y?: number;
  color?: string;
}) {
  const Component = Object.hasOwn(ICON_COMPONENTS, name)
    ? ICON_COMPONENTS[name]
    : ICON_COMPONENTS[FALLBACK_ICON];
  return (
    <Component
      size={size}
      stroke={2}
      aria-hidden
      focusable="false"
      {...(x !== undefined ? { x } : {})}
      {...(y !== undefined ? { y } : {})}
      {...(color ? { color } : {})}
    />
  );
}

/**
 * The HTML stamp of a marker (the ruler's lane, the legend and the "Next up" rows): a tinted
 * circle with a dashed edge and the pictogram; `count` makes it a neutral cluster stamp.
 */
export function LaneStamp({
  visual,
  confidence = 'high',
  size = 24,
  count,
}: {
  visual?: UpcomingVisual;
  confidence?: UpcomingConfidence;
  size?: number;
  count?: number;
}) {
  const theme = useTheme();
  const pair = palette(theme).category[visual?.category ?? 'custom'];
  return (
    <Box
      component="span"
      aria-hidden
      data-stamp={visual?.icon ?? 'cluster'}
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        width: size,
        height: size,
        boxSizing: 'border-box',
        borderRadius: '50%',
        backgroundColor: pair.bg,
        color: pair.fg,
        border: `1.5px dashed ${pair.fg}`,
        opacity: CONFIDENCE_STRENGTH[confidence],
        fontSize: Math.round(size * 0.5),
        fontWeight: 700,
        lineHeight: 1,
        fontVariantNumeric: 'tabular-nums',
        '@media (forced-colors: active)': { border: '1.5px dashed CanvasText' },
      }}
    >
      {count !== undefined ? (
        count
      ) : (
        <Pictogram name={visual?.icon ?? FALLBACK_ICON} size={Math.round(size * 0.62)} />
      )}
    </Box>
  );
}
