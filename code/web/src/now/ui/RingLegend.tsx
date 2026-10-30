import { useTranslation } from 'react-i18next';
import { Box, Typography, useTheme } from '@mui/material';
import type { RingLaneLegendKey, RingLegendKey } from '../ringGeometry';
import type { FaceState } from '../rhythmDetails';
import type { UpcomingKind } from '../upcoming';
import { BabyFace } from './BabyFace';
import { LaneStamp } from './LaneStamp';
import { kindVisual } from './upcomingVisual';
import { palette } from '../../ui/form/styles';
import { projectedLook, ringSwatchColors } from './ringSwatch';

const LABEL_KEY = {
  night: 'now.ring.legendNight',
  nap: 'now.ring.legendNap',
  waking: 'now.ring.legendWaking',
  window: 'now.ring.legendWindow',
  projected: 'now.ring.legendProjected',
  wake: 'now.ring.legendWake',
  bedtime: 'now.ring.legendBedtime',
  now: 'now.ring.legendNow',
  feeds: 'now.ring.legendFeeds',
  diapers: 'now.ring.legendDiapers',
  patterns: 'now.ring.legendPatterns',
  medicine: 'now.ring.legendMedicine',
} as const satisfies Record<RingLegendKey, string>;

/** The stamp of each "next up" layer in the legend (the first kind of the layer). */
const LANE_SWATCH: Record<RingLaneLegendKey, UpcomingKind> = {
  feeds: 'feed',
  diapers: 'diaperWet',
  patterns: 'bellyPain',
  medicine: 'medicine',
};

const isLaneKey = (kind: RingLegendKey): kind is RingLaneLegendKey =>
  Object.hasOwn(LANE_SWATCH, kind);

/** A small picture of one mark, drawn exactly as on the ring ("now" is the baby face shown). */
function Swatch({ kind, face }: { kind: RingLegendKey; face: FaceState }) {
  const theme = useTheme();
  if (isLaneKey(kind)) return <LaneStamp visual={kindVisual(LANE_SWATCH[kind])} size={20} />;
  if (kind === 'now') {
    return (
      <Box component="span" data-testid="ring-legend-face" sx={{ display: 'inline-flex' }}>
        <BabyFace face={face} size={20} />
      </Box>
    );
  }
  const colors = ringSwatchColors(theme);
  if (kind === 'wake') {
    // The dotted tail of the running nap and the small ring of the likely wake-up.
    const look = colors.wake;
    return (
      <svg width="22" height="14" viewBox="0 0 22 14" aria-hidden focusable="false">
        <line
          x1="1"
          y1="7"
          x2="14"
          y2="7"
          stroke={look.stroke}
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={look.dash}
        />
        <circle cx="17" cy="7" r="3.5" fill="none" stroke={look.stroke} strokeWidth="1.5" />
      </svg>
    );
  }
  // A projected nap is shown one step out, as most of them are drawn.
  const look = kind === 'projected' ? projectedLook(palette(theme).primary.main, 1) : colors[kind];
  return (
    <svg width="22" height="14" viewBox="0 0 22 14" aria-hidden focusable="false">
      <rect
        x="1"
        y="2"
        width="20"
        height="10"
        rx="3"
        fill={look.fill}
        fillOpacity={look.fillOpacity ?? 1}
        stroke={look.stroke}
        strokeOpacity={look.strokeOpacity ?? 1}
        strokeWidth={look.stroke === 'none' ? 0 : 1.5}
        strokeDasharray={look.dash}
      />
    </svg>
  );
}

/**
 * The key under the ring: one swatch and a word for each kind of mark the ring draws (sleep, the
 * nap window, now). A list, small, wrapping on narrow screens; the words carry the meaning, not a
 * tooltip.
 */
export function RingLegend({
  keys,
  face = 'awake',
  label,
}: {
  keys: readonly RingLegendKey[];
  /** The face the "now" marker shows, repeated in its legend entry. */
  face?: FaceState;
  /** Name of the list (default "What the ring shows"). */
  label?: string;
}) {
  const { t } = useTranslation();
  return (
    <Box
      component="ul"
      aria-label={label ?? t('now.ring.legendLabel')}
      data-testid="ring-legend"
      sx={{
        m: 0,
        p: 0,
        listStyle: 'none',
        display: 'flex',
        flexWrap: 'wrap',
        justifyContent: 'center',
        gap: '4px 14px',
      }}
    >
      {keys.map((key) => (
        <Box
          component="li"
          key={key}
          data-testid={`ring-legend-${key}`}
          sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, minHeight: 24 }}
        >
          <Swatch kind={key} face={face} />
          <Typography variant="caption" color="text.secondary">
            {t(LABEL_KEY[key])}
          </Typography>
        </Box>
      ))}
    </Box>
  );
}
