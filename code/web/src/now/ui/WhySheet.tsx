import { useTranslation } from 'react-i18next';
import { Button, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { usePushDevice } from '../../notifications/PushDeviceContext';
import { usePushConfig } from '../../notifications/usePush';
import { Icon } from '../../ui/Icon';
import { describeReason } from '../../predictions/predictionModel';
import type { PredictionDto } from '../../sync/contract';
import type { NapWindow } from '../nowState';
import { SheetFrame } from './SheetFrame';

interface Props {
  open: boolean;
  onClose: () => void;
  window: NapWindow;
  /** The full server prediction (typical duration), when it is at hand. */
  prediction?: PredictionDto;
}

/** The nap window as a prediction the "Why?" helper understands. */
function predictionOf(window: NapWindow, full: PredictionDto | undefined): PredictionDto {
  return (
    full ?? {
      typeKey: 'sleep',
      nextStart: { earliest: window.earliest, expected: window.expected, latest: window.latest },
      expectedDuration: null,
      confidence: window.confidence,
      sampleCount: window.sampleCount,
      reason: '',
      basis: window.basis,
    }
  );
}

/** "Remind me when the window opens": only where push can work and the server has it on. */
function NapReminderLink({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const device = usePushDevice();
  const config = usePushConfig();
  if (device.support() !== 'supported' || !config.data?.enabled) return null;
  return (
    <Button
      component={RouterLink}
      to="/settings#notifications"
      onClick={onClose}
      startIcon={<Icon name="bell" size={20} />}
      sx={{ minHeight: 48, alignSelf: 'flex-start' }}
    >
      {t('notifications.whyLink')}
    </Button>
  );
}

/** "Why?" of the nap window: the sentence built from the server's `basis`, and the disclaimer. */
export function WhySheet({ open, onClose, window, prediction }: Props) {
  const { t } = useTranslation();
  return (
    <SheetFrame open={open} onClose={onClose} title={t('now.why.title')}>
      <Typography>
        {describeReason(predictionOf(window, prediction)) || t('now.why.noBasis')}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {t('predictions.disclaimer')}
      </Typography>
      <NapReminderLink onClose={onClose} />
    </SheetFrame>
  );
}
