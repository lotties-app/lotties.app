import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Card, LinearProgress, Typography } from '@mui/material';
import { useUnits } from '../../units/useUnits';
import { shownMilk } from '../milkToday';
import type { MilkToday } from '../todayStats';

/** Widest glyph advance of the serif numbers, as a share of the font size (measured, with margin). */
const GLYPH_WIDTH = 0.62;

/**
 * Font size of the two numbers: as large as the h4 (2rem), but never wider than the column, so the
 * longer of the two values stays on one line; one size for both (equal columns, same length).
 */
const numberSize = (values: readonly string[]) => {
  const longest = Math.max(...values.map((value) => value.length));
  return `min(2rem, ${(100 / (longest * GLYPH_WIDTH)).toFixed(1)}cqi)`;
};

interface Amount {
  key: string;
  value: string;
  caption: string;
}

/**
 * "Milk today": what was drunk and what was prepared in today's finished bottles, side by side, a
 * thin decorative bar of drunk out of prepared, and what was not drunk when anything was left.
 * Facts only: no percentage, target or judgement. Hidden without a bottle amount (`milk === null`).
 */
export function MilkTodayCard({ milk }: { milk: MilkToday | null }) {
  const { t } = useTranslation();
  const units = useUnits();
  const headingId = useId();
  if (milk === null) return null;
  const shown = shownMilk(milk, units.system);
  const amounts: Amount[] = [
    { key: 'drunk', value: units.formatVolume(shown.drunkMl), caption: t('now.milkToday.drunk') },
    {
      key: 'prepared',
      value: units.formatVolume(shown.preparedMl),
      caption: t('now.milkToday.prepared'),
    },
  ];
  const fontSize = numberSize(amounts.map((amount) => amount.value));
  return (
    <Card component="section" aria-labelledby={headingId} sx={{ p: 2 }}>
      <Typography
        id={headingId}
        variant="overline"
        component="h2"
        color="text.secondary"
        sx={{ display: 'block', mb: 1 }}
      >
        {t('now.milkToday.title')}
      </Typography>
      <Box
        component="dl"
        sx={{ m: 0, display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 1.5 }}
      >
        {amounts.map((amount) => (
          <Box
            key={amount.key}
            sx={{
              minWidth: 0,
              display: 'flex',
              flexDirection: 'column-reverse',
              containerType: 'inline-size',
            }}
          >
            <Typography
              component="dt"
              variant="caption"
              color="text.secondary"
              sx={{ lineHeight: 1.3 }}
            >
              {amount.caption}
            </Typography>
            <Typography
              component="dd"
              variant="h4"
              sx={{
                m: 0,
                lineHeight: 1.15,
                fontVariantNumeric: 'tabular-nums',
                // One line, scaled to the column (`numberSize`), like the Today tiles.
                whiteSpace: 'nowrap',
                overflowWrap: 'normal',
                fontSize,
              }}
            >
              {amount.value}
            </Typography>
          </Box>
        ))}
      </Box>
      <LinearProgress
        aria-hidden
        variant="determinate"
        value={Math.round(shown.drunkShare * 100)}
        sx={{ mt: 1.5, height: 6, borderRadius: 3 }}
      />
      {shown.notDrunkMl > 0 && (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          {t('now.milkToday.notDrunk', { volume: units.formatVolume(shown.notDrunkMl) })}
        </Typography>
      )}
    </Card>
  );
}
