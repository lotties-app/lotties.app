import { useTranslation } from 'react-i18next';
import { Box, Button, Typography } from '@mui/material';
import { formatDuration, formatTime } from '../../i18n/format';
import { Illustration } from '../../ui/illustrations';
import { napGuidance } from '../napGuidance';
import { SheetFrame } from './SheetFrame';

const MINUTE_MS = 60_000;

interface Props {
  open: boolean;
  onClose: () => void;
  window: { earliest: string; latest: string };
  /** The typical nap length from the prediction, when there is one. */
  expectedMinutes?: number;
  now: Date;
  /** Viewers cannot log. */
  readOnly: boolean;
  /** Hides this prediction until the next one. */
  onSkip: () => void;
  /** Starts the nap timer. */
  onLog: () => void;
}

/**
 * The estimated nap sheet (opened from the nap window of the state card): the window in large
 * serif numerals, the typical length, one calm line about when to start winding down, and the two
 * choices, Skip (until the next prediction) and Log nap now. No claims beyond the numbers.
 */
export function NapSheet({
  open,
  onClose,
  window,
  expectedMinutes,
  now,
  readOnly,
  onSkip,
  onLog,
}: Props) {
  const { t } = useTranslation();
  const guidance = napGuidance(window, now);
  const line =
    guidance.kind === 'windDown'
      ? t('now.napSheet.windDown', { time: formatTime(guidance.at) })
      : t(`now.napSheet.${guidance.kind}`);
  return (
    <SheetFrame open={open} onClose={onClose} title={t('now.napSheet.title')}>
      <Box sx={{ display: 'grid', justifyItems: 'center', gap: 1, textAlign: 'center' }}>
        <Illustration name="nap" size={96} glow />
        <Typography
          variant="h4"
          component="p"
          data-testid="nap-sheet-window"
          sx={{ fontVariantNumeric: 'lining-nums tabular-nums' }}
        >
          {t('now.nap.range', { from: formatTime(window.earliest), to: formatTime(window.latest) })}
        </Typography>
        {expectedMinutes !== undefined && expectedMinutes > 0 && (
          <Typography color="text.secondary">
            {t('now.napSheet.about', { duration: formatDuration(expectedMinutes * MINUTE_MS) })}
          </Typography>
        )}
        <Typography sx={{ maxWidth: 320 }}>{line}</Typography>
      </Box>
      <Box sx={{ display: 'flex', gap: 1.5 }}>
        <Button
          variant="outlined"
          color="inherit"
          onClick={onSkip}
          sx={{ flex: 1, minHeight: 56, borderRadius: '999px' }}
        >
          {t('now.napSheet.skip')}
        </Button>
        <Button
          variant="contained"
          disabled={readOnly}
          onClick={onLog}
          sx={{ flex: 1.4, minHeight: 56, borderRadius: '999px' }}
        >
          {t('now.napSheet.log')}
        </Button>
      </Box>
    </SheetFrame>
  );
}
