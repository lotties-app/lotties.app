import { useState } from 'react';
import { Button, Card, Chip, Collapse, Stack, Typography } from '@mui/material';
import type { EventType } from '../db/models';
import { EventTypeIcon } from '../events/eventIcons';
import { safeColor } from '../events/safeColor';
import type { PredictionConfidence, PredictionDto } from '../sync/contract';
import { getOwn } from '../util/ownProperty';
import { describeDuration, describeWindow, isOverdue } from './predictionModel';

const CONFIDENCE_COLOR: Record<PredictionConfidence, 'success' | 'info' | 'default'> = {
  High: 'success',
  Medium: 'info',
  Low: 'default',
};

interface Props {
  prediction: PredictionDto;
  type: EventType | undefined;
  name: string;
  now: Date;
}

export function PredictionCard({ prediction, type, name, now }: Props) {
  const [showReason, setShowReason] = useState(false);
  const overdue = isOverdue(prediction, now);
  const duration = describeDuration(prediction);
  const reasonId = `prediction-reason-${prediction.typeKey}`;

  return (
    <Card variant="outlined" component="article" aria-label={`Next ${name}`} sx={{ p: 2 }}>
      <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
        <EventTypeIcon name={type?.icon ?? ''} color={safeColor(type?.color ?? '')} fontSize={28} />
        <Typography variant="subtitle1" sx={{ flexGrow: 1 }}>
          Next {name}
        </Typography>
        {overdue && <Chip size="small" color="warning" label="Overdue" />}
        <Chip
          size="small"
          variant="outlined"
          color={getOwn(CONFIDENCE_COLOR, prediction.confidence) ?? 'default'}
          label={`${prediction.confidence} confidence`}
        />
      </Stack>
      <Typography sx={{ mt: 1 }}>
        {describeWindow(prediction, now)}
        {duration && `; ${duration}`}
      </Typography>
      <Button
        size="small"
        onClick={() => setShowReason((v) => !v)}
        aria-expanded={showReason}
        aria-controls={reasonId}
        sx={{ mt: 0.5, ml: -1 }}
      >
        Why?
      </Button>
      <Collapse in={showReason} id={reasonId}>
        <Typography variant="body2" color="text.secondary">
          {prediction.reason}
        </Typography>
      </Collapse>
    </Card>
  );
}
