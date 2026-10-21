import { Box } from '@mui/material';
import { formatTime } from '../i18n/format';
import type { CategoryName } from '../theme/tokens';
import { palette } from '../ui/form/styles';
import type { DaySummary } from './dayModel';

const HOUR_MARKS = [0, 6, 12, 18] as const;

const percent = (ratio: number) => `${(ratio * 100).toFixed(3)}%`;

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
  );
}
