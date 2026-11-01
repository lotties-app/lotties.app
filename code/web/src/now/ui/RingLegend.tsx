import { useTranslation } from 'react-i18next';
import { Box, Typography, useTheme } from '@mui/material';
import { palette } from '../../ui/form/styles';
import type { RingLegendKey } from '../ringGeometry';
import { ringSwatchColors } from './ringSwatch';

const LABEL_KEY = {
  night: 'now.ring.legendNight',
  nap: 'now.ring.legendNap',
  waking: 'now.ring.legendWaking',
  window: 'now.ring.legendWindow',
  now: 'now.ring.legendNow',
} as const satisfies Record<RingLegendKey, string>;

/** A small picture of one mark, drawn exactly as on the ring. */
function Swatch({ kind }: { kind: RingLegendKey }) {
  const theme = useTheme();
  const accent = palette(theme).primary.main;
  if (kind === 'now') {
    return (
      <svg width="18" height="14" viewBox="0 0 18 14" aria-hidden focusable="false">
        <line
          x1="9"
          y1="13"
          x2="9"
          y2="5"
          stroke={accent}
          strokeWidth="2.5"
          strokeLinecap="round"
        />
        <circle cx="9" cy="4" r="3.5" fill={accent} />
      </svg>
    );
  }
  const look = ringSwatchColors(theme)[kind];
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
        strokeWidth={look.stroke === 'none' ? 0 : 1.5}
        strokeDasharray={kind === 'window' ? '4 3' : undefined}
      />
    </svg>
  );
}

/**
 * The key under the ring: one swatch and a word for each kind of mark the ring draws (sleep, the
 * nap window, now). A list, small, wrapping on narrow screens; the words carry the meaning, not a
 * tooltip.
 */
export function RingLegend({ keys }: { keys: readonly RingLegendKey[] }) {
  const { t } = useTranslation();
  return (
    <Box
      component="ul"
      aria-label={t('now.ring.legendLabel')}
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
          <Swatch kind={key} />
          <Typography variant="caption" color="text.secondary">
            {t(LABEL_KEY[key])}
          </Typography>
        </Box>
      ))}
    </Box>
  );
}
