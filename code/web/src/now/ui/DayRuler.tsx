import { useTranslation } from 'react-i18next';
import { Box, Typography } from '@mui/material';
import { formatTime } from '../../i18n/format';
import { palette } from '../../ui/form/styles';
import { rulerGeometry, type RulerInput } from '../rulerGeometry';

/**
 * The "day ruler" (docs/design/02-visual-identity.md, direction B): the awake window as an ink
 * line from waking up to now, the predicted nap window as a soft band, and "now" as a terracotta
 * mark. It replaces a progress ring. The bar is an image for assistive technology, described by
 * `now.ruler.*`; the times printed under it repeat what the description says.
 */

export function DayRuler(props: RulerInput) {
  const { t } = useTranslation();
  const { since, now, window } = props;
  const geometry = rulerGeometry(props);
  const label = window
    ? t('now.ruler.withWindow', {
        since: formatTime(since),
        now: formatTime(now),
        from: formatTime(window.earliest),
        to: formatTime(window.latest),
      })
    : t('now.ruler.noWindow', { since: formatTime(since), now: formatTime(now) });

  return (
    <Box>
      <Box role="img" aria-label={label} sx={{ position: 'relative', height: 20, mt: 1, mb: 0.5 }}>
        <Box
          sx={(theme) => ({
            position: 'absolute',
            left: 0,
            right: 0,
            top: 8,
            height: 4,
            borderRadius: 2,
            backgroundColor: palette(theme).hairline,
          })}
        />
        {geometry.band && (
          <Box
            data-testid="ruler-window"
            sx={(theme) => ({
              position: 'absolute',
              top: 3,
              height: 14,
              borderRadius: 7,
              left: `${geometry.band?.left}%`,
              width: `${(geometry.band?.right ?? 0) - (geometry.band?.left ?? 0)}%`,
              minWidth: 8,
              backgroundColor: palette(theme).primary.main,
              opacity: 0.32,
            })}
          />
        )}
        <Box
          data-testid="ruler-awake"
          sx={(theme) => ({
            position: 'absolute',
            left: 0,
            top: 8,
            height: 4,
            borderRadius: 2,
            width: `${geometry.nowPercent}%`,
            backgroundColor: palette(theme).selection,
          })}
        />
        <Box
          data-testid="ruler-now"
          sx={(theme) => ({
            position: 'absolute',
            top: 0,
            height: 20,
            width: 4,
            marginLeft: '-2px',
            borderRadius: 2,
            left: `${geometry.nowPercent}%`,
            backgroundColor: palette(theme).primary.main,
          })}
        />
      </Box>
      <Box aria-hidden sx={{ display: 'flex', justifyContent: 'space-between' }}>
        <Typography variant="caption" color="text.secondary">
          {formatTime(geometry.start)}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {formatTime(geometry.end)}
        </Typography>
      </Box>
    </Box>
  );
}
