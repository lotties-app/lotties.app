import { useTranslation } from 'react-i18next';
import { Box, Typography } from '@mui/material';
import { formatDuration, formatNumber } from '../../i18n/format';
import { RADIUS } from '../../theme/tokens';
import { palette } from '../../ui/form/styles';
import { hasTodayData, type TodayStats } from '../todayStats';

const MINUTE_MS = 60_000;

interface Stat {
  key: string;
  label: string;
  value: string;
  note?: string;
}

/**
 * "Today" strip: last night's sleep, naps, feeds and diapers as a few serif numbers. A value
 * without data is left out, and the whole strip is hidden when there is nothing to show.
 */
export function TodayStrip({ stats }: { stats: TodayStats }) {
  const { t } = useTranslation();
  if (!hasTodayData(stats)) return null;
  const items: Stat[] = [];
  if (stats.lastNightMinutes !== null) {
    items.push({
      key: 'night',
      label: t('now.today.lastNight'),
      value: formatDuration(stats.lastNightMinutes * MINUTE_MS),
    });
  }
  if (stats.naps.count > 0) {
    items.push({
      key: 'naps',
      label: t('now.today.naps'),
      value: formatNumber(stats.naps.count),
      note: formatDuration(stats.naps.minutes * MINUTE_MS),
    });
  }
  if (stats.feeds > 0) {
    items.push({ key: 'feeds', label: t('now.today.feeds'), value: formatNumber(stats.feeds) });
  }
  if (stats.diapers > 0) {
    items.push({
      key: 'diapers',
      label: t('now.today.diapers'),
      value: formatNumber(stats.diapers),
    });
  }
  return (
    <Box component="section" aria-label={t('now.today.title')}>
      <Typography
        variant="overline"
        component="h2"
        color="text.secondary"
        sx={{ display: 'block', mb: 1 }}
      >
        {t('now.today.title')}
      </Typography>
      <Box
        component="dl"
        sx={{
          m: 0,
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))',
          gap: 1.5,
        }}
      >
        {items.map((item) => (
          <Box
            key={item.key}
            sx={(theme) => ({
              p: 1.5,
              borderRadius: `${RADIUS.tile}px`,
              backgroundColor: palette(theme).surfaceRaised,
            })}
          >
            <Typography component="dt" variant="caption" color="text.secondary">
              {item.label}
            </Typography>
            <Typography
              component="dd"
              variant="h4"
              sx={{ m: 0, fontVariantNumeric: 'tabular-nums' }}
            >
              {item.value}
            </Typography>
            {item.note && (
              <Typography component="dd" variant="caption" color="text.secondary" sx={{ m: 0 }}>
                {item.note}
              </Typography>
            )}
          </Box>
        ))}
      </Box>
    </Box>
  );
}
