import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Button, Typography } from '@mui/material';
import { describeBedTime, describeBedTimeReason } from '../../predictions/predictionModel';
import type { BedTimeDto } from '../../sync/contract';
import { Icon } from '../../ui/Icon';
import { SheetFrame } from './SheetFrame';

/**
 * A quiet "Bedtime around 19:50" line on the awake state card (heuristic v1.1 `bedTime`), with a
 * "Why?" sheet built from its `basis`. Renders nothing when the server sent no bed time.
 */
export function BedtimeLine({ bedTime, now }: { bedTime: BedTimeDto; now: Date }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <Box
      sx={{
        mt: 1.5,
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        justifyContent: 'space-between',
      }}
    >
      <Typography
        variant="body2"
        color="text.secondary"
        sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}
      >
        <Icon name="moon" size={16} />
        <span>{describeBedTime(bedTime, now)}</span>
      </Typography>
      <Button
        size="small"
        onClick={() => setOpen(true)}
        sx={{ minHeight: 44, minWidth: 44, flexShrink: 0, whiteSpace: 'nowrap' }}
      >
        {t('predictions.why')}
      </Button>
      <SheetFrame open={open} onClose={() => setOpen(false)} title={t('now.why.title')}>
        <Typography>{describeBedTimeReason(bedTime, now) || t('now.why.noBasis')}</Typography>
        <Typography variant="body2" color="text.secondary">
          {t('predictions.disclaimer')}
        </Typography>
      </SheetFrame>
    </Box>
  );
}
