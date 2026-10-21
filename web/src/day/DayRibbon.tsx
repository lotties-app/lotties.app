import { useTranslation } from 'react-i18next';
import { Box, Typography } from '@mui/material';
import { formatTime } from '../i18n/format';
import { CATEGORY_NAMES, type CategoryName } from '../theme/tokens';
import { Illustration } from '../ui/illustrations';
import { palette } from '../ui/form/styles';
import type { DaySummary } from './dayModel';

const HOUR_MARKS = [0, 6, 12, 18] as const;

const percent = (ratio: number) => `${(ratio * 100).toFixed(3)}%`;

/** The illustration that stands for each category in the legend. */
const LEGEND_ART: Readonly<Record<CategoryName, string>> = {
  sleep: 'nap',
  feeding: 'bottle',
  diaper: 'diaper',
  health: 'medication',
  care: 'bath',
  activity: 'tummy_time',
  nightWaking: 'night_waking',
  custom: 'custom',
};

/** What the colours of the ribbon mean: the categories drawn on it, with their illustrations. */
function RibbonLegend({ summary }: { summary: DaySummary }) {
  const { t } = useTranslation();
  const present = new Set<CategoryName>([
    ...summary.spans.map((span) => span.category),
    ...summary.ticks.map((tick) => tick.category),
  ]);
  const shown = CATEGORY_NAMES.filter((name) => present.has(name));
  if (shown.length === 0) return null;
  return (
    <Box
      component="ul"
      aria-label={t('day.ribbon.legend')}
      sx={{ m: 0, p: 0, listStyle: 'none', display: 'flex', flexWrap: 'wrap', gap: '4px 14px' }}
    >
      {shown.map((name) => (
        <Box
          component="li"
          key={name}
          sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}
        >
          <Illustration name={LEGEND_ART[name]} size={24} />
          <Typography variant="caption" color="text.secondary">
            {t(`day.category.${name}`)}
          </Typography>
        </Box>
      ))}
    </Box>
  );
}

/**
 * A thin 24-hour strip of the day: sleep as coloured stretches, feeds, diapers and health events
 * as ticks in their category colour. The text alternative says the totals; the hour marks under it
 * are decoration (the rows below carry the exact times).
 */
export function DayRibbon({ summary, label }: { summary: DaySummary; label: string }) {
  const color =
    (category: CategoryName) =>
    // Read from the active scheme's variables, so the strip follows light, dark and night.
    (theme: Parameters<typeof palette>[0]) =>
      palette(theme).category[category].fg;
  return (
    <Box sx={{ display: 'grid', gap: 0.75 }}>
      <Box role="img" aria-label={label} sx={{ display: 'grid', gap: 0.5 }}>
        <Box
          aria-hidden
          sx={(theme) => ({
            position: 'relative',
            height: 20,
            borderRadius: '10px',
            backgroundColor: palette(theme).surfaceRaised,
            overflow: 'hidden',
          })}
        >
          {summary.spans.map((span) => (
            <Box
              key={span.id}
              sx={(theme) => ({
                position: 'absolute',
                top: 0,
                bottom: 0,
                left: percent(span.from),
                width: percent(span.to - span.from),
                minWidth: 3,
                backgroundColor: `color-mix(in srgb, ${color(span.category)(theme)} 45%, transparent)`,
              })}
            />
          ))}
          {summary.ticks.map((tick) => (
            <Box
              key={tick.id}
              sx={(theme) => ({
                position: 'absolute',
                top: 4,
                bottom: 4,
                left: percent(tick.at),
                width: 3,
                ml: '-1.5px',
                borderRadius: '2px',
                backgroundColor: color(tick.category)(theme),
              })}
            />
          ))}
        </Box>
        <Box
          aria-hidden
          sx={{
            position: 'relative',
            height: 16,
            fontSize: '0.75rem',
            color: 'text.secondary',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {HOUR_MARKS.map((hour) => (
            <Box
              key={hour}
              component="span"
              sx={{
                position: 'absolute',
                left: percent(hour / 24),
                transform: hour === 0 ? 'none' : 'translateX(-50%)',
              }}
            >
              {formatTime(new Date(2000, 0, 1, hour))}
            </Box>
          ))}
        </Box>
      </Box>
      <RibbonLegend summary={summary} />
    </Box>
  );
}
