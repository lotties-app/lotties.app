import { useTranslation } from 'react-i18next';
import { Typography } from '@mui/material';
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
    </SheetFrame>
  );
}
