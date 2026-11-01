import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card, Chip, Collapse, Stack, Typography } from '@mui/material';
import type { EventType } from '../db/models';
import { EventTypeIcon } from '../events/eventIcons';
import { safeColor } from '../events/safeColor';
import type { PredictionConfidence, PredictionDto } from '../sync/contract';
import { getOwn } from '../util/ownProperty';
import { describeDuration, describeReason, describeWindow, isOverdue } from './predictionModel';

const CONFIDENCE_COLOR: Record<PredictionConfidence, 'success' | 'info' | 'default'> = {
  High: 'success',
  Medium: 'info',
  Low: 'default',
};

const CONFIDENCE_LABEL = {
  High: 'predictions.confidence.high',
  Medium: 'predictions.confidence.medium',
  Low: 'predictions.confidence.low',
} as const satisfies Record<PredictionConfidence, string>;

interface Props {
  prediction: PredictionDto;
  type: EventType | undefined;
  name: string;
  now: Date;
}

export function PredictionCard({ prediction, type, name, now }: Props) {
  const { t } = useTranslation();
  const [showReason, setShowReason] = useState(false);
  const overdue = isOverdue(prediction, now);
  const duration = describeDuration(prediction);
  const reasonId = `prediction-reason-${prediction.typeKey}`;

  return (
    <Card
      variant="outlined"
      component="article"
      aria-label={t('predictions.next', { name })}
      sx={{ p: 2 }}
    >
      <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
        <EventTypeIcon name={type?.icon ?? ''} color={safeColor(type?.color ?? '')} size={24} />
        <Typography variant="subtitle1" sx={{ flexGrow: 1 }}>
          {t('predictions.next', { name })}
        </Typography>
        {overdue && <Chip size="small" color="warning" label={t('predictions.overdue')} />}
        <Chip
          size="small"
          variant="outlined"
          color={getOwn(CONFIDENCE_COLOR, prediction.confidence) ?? 'default'}
          label={t(CONFIDENCE_LABEL[prediction.confidence])}
        />
      </Stack>
      <Typography sx={{ mt: 1 }}>
        {duration
          ? t('predictions.windowWithDuration', {
              window: describeWindow(prediction, now),
              duration,
            })
          : describeWindow(prediction, now)}
      </Typography>
      <Button
        size="small"
        onClick={() => setShowReason((v) => !v)}
        aria-expanded={showReason}
        aria-controls={reasonId}
        sx={{ mt: 0.5, ml: -1 }}
      >
        {t('predictions.why')}
      </Button>
      <Collapse in={showReason} id={reasonId}>
        <Typography variant="body2" color="text.secondary">
          {describeReason(prediction)}
        </Typography>
      </Collapse>
    </Card>
  );
}
