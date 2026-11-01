import { useTranslation } from 'react-i18next';
import { Box, Typography } from '@mui/material';
import { formatDurationCompact, formatNumber } from '../../i18n/format';
import { RADIUS } from '../../theme/tokens';
import { palette } from '../../ui/form/styles';
import { hasTodayData, type TodayStats } from '../todayStats';

const MINUTE_MS = 60_000;
/** One line of caption text; reserved in every tile so the tiles share one height. */
const NOTE_HEIGHT = '1.3em';

interface Stat {
  key: string;
  label: string;
  value: string;
  note?: string;
}

/**
 * "Today" strip: last night's sleep, naps, feeds and diapers as a few serif numbers. A value
 * without data is left out, and the whole strip is hidden when there is nothing to show.
 *
 * Layout: two by two, one row once the strip itself is 32rem wide (a container query, so the width
 * of the column counts, not the window). Each tile is a size container, so the value
 * scales with the tile and a duration like "9h 36min" stays on one line at any width or text size.
 */
export function TodayStrip({ stats }: { stats: TodayStats }) {
  const { t } = useTranslation();
  if (!hasTodayData(stats)) return null;
  const items: Stat[] = [];
  if (stats.lastNightMinutes !== null) {
    items.push({
      key: 'night',
      label: t('now.today.lastNight'),
      value: formatDurationCompact(stats.lastNightMinutes * MINUTE_MS),
    });
  }
  if (stats.naps.count > 0) {
    items.push({
      key: 'naps',
      label: t('now.today.naps'),
      value: formatNumber(stats.naps.count),
      note: formatDurationCompact(stats.naps.minutes * MINUTE_MS),
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
    <Box
      component="section"
      aria-label={t('now.today.title')}
      sx={{ containerType: 'inline-size' }}
    >
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
          gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
          '@container (min-width: 32rem)': { gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' },
          gap: 1.5,
        }}
      >
        {items.map((item) => (
          <Box
            key={item.key}
            sx={(theme) => ({
              p: 1.5,
              minWidth: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: 0.25,
              containerType: 'inline-size',
              borderRadius: `${RADIUS.tile}px`,
              backgroundColor: palette(theme).surfaceRaised,
            })}
          >
            <Typography
              component="dt"
              variant="caption"
              color="text.secondary"
              sx={{ lineHeight: 1.3 }}
            >
              {item.label}
            </Typography>
            <Typography
              component="dd"
              variant="h4"
              sx={{
                m: 0,
                whiteSpace: 'nowrap',
                lineHeight: 1.15,
                fontVariantNumeric: 'tabular-nums',
                fontSize: 'min(1.75rem, 19cqi)',
              }}
            >
              {item.value}
            </Typography>
            {item.note ? (
              <Typography
                component="dd"
                variant="caption"
                color="text.secondary"
                sx={{ m: 0, minHeight: NOTE_HEIGHT, lineHeight: 1.3, whiteSpace: 'nowrap' }}
              >
                {item.note}
              </Typography>
            ) : (
              <Box aria-hidden sx={{ minHeight: NOTE_HEIGHT }} />
            )}
          </Box>
        ))}
      </Box>
    </Box>
  );
}
