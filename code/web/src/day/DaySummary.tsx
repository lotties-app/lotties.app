import { useTranslation } from 'react-i18next';
import { Box, Typography } from '@mui/material';
import { formatDuration, formatNumber } from '../i18n/format';
import { palette } from '../ui/form/styles';
import { DayRibbon } from './DayRibbon';
import { ribbonLabel } from './ribbonLabel';
import type { DaySummary as Summary } from './dayModel';

const MINUTE_MS = 60_000;

/**
 * The summary strip of a day (sleep total, feeds, diapers as serif numbers between two rules) and
 * the 24-hour ribbon under it. Always three values, zeros included: a quiet day is information.
 */
export function DaySummary({ summary }: { summary: Summary }) {
  const { t } = useTranslation();
  const items = [
    {
      key: 'sleep',
      label: t('day.summary.sleep'),
      value: summary.sleepMinutes > 0 ? formatDuration(summary.sleepMinutes * MINUTE_MS) : '–',
    },
    { key: 'feeds', label: t('day.summary.feeds'), value: formatNumber(summary.feeds) },
    { key: 'diapers', label: t('day.summary.diapers'), value: formatNumber(summary.diapers) },
  ];
  return (
    <Box component="section" aria-label={t('day.summary.title')} sx={{ display: 'grid', gap: 1.5 }}>
      <Box
        component="dl"
        sx={(theme) => ({
          m: 0,
          display: 'grid',
          gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
          borderTop: `1px solid ${palette(theme).text.primary}`,
          borderBottom: `1px solid ${palette(theme).hairline}`,
        })}
      >
        {items.map((item) => (
          <Box key={item.key} sx={{ py: 1, pr: 1, minWidth: 0 }}>
            <Typography component="dt" variant="caption" color="text.secondary">
              {item.label}
            </Typography>
            <Typography component="dd" variant="h6" sx={{ m: 0, fontWeight: 400 }}>
              {item.value}
            </Typography>
          </Box>
        ))}
      </Box>
      <DayRibbon summary={summary} label={ribbonLabel(summary, t)} />
    </Box>
  );
}
