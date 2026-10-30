import { useState } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { Alert, Box, Button, Card, Skeleton, Stack, Typography } from '@mui/material';
import { formatDate, formatTime } from '../i18n/format';
import { Icon } from '../ui/Icon';
import type { RestEstimate, RestPart } from './restApi';
import { shiftNight } from './restModel';
import { MorningQuestion } from './MorningQuestion';
import { restEstimateKey, useRestEstimate } from './useRest';

const NAV_BUTTON = { minWidth: 44, minHeight: 44 } as const;

function partText(part: RestPart, t: TFunction): string {
  const start = formatTime(part.start);
  const main = part.end
    ? t('rest.part.range', { start, end: formatTime(part.end) })
    : t('rest.part.ongoing', { start });
  const notes = [
    part.endSource === 'confirmed' ? t('rest.part.confirmed') : null,
    part.confidence === 'low' ? t('rest.part.lowConfidence') : null,
  ].filter(Boolean);
  return notes.length > 0 ? `${main} (${notes.join(', ')})` : main;
}

function Parts({ estimate }: { estimate: RestEstimate }) {
  const { t } = useTranslation();
  if (estimate.status === 'disabled') return <Typography>{t('rest.status.disabled')}</Typography>;
  if (estimate.status === 'notEnoughLog' || estimate.parts.length === 0) {
    return <Typography>{t('rest.status.notEnoughLog')}</Typography>;
  }
  return (
    <Box component="ul" aria-label={t('rest.parts')} sx={{ m: 0, pl: 2.5 }}>
      {estimate.parts.map((part) => (
        <Typography key={part.start} component="li">
          {partText(part, t)}
        </Typography>
      ))}
    </Box>
  );
}

/**
 * Last night as approximate times, with a previous / next night control. Online-only: offline it
 * keeps showing the last answer in the memory cache, marked as such.
 */
export function RestEstimateCard() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [night, setNight] = useState<string | null>(null);
  // The morning question is asked again the next time the tab opens: "not yet" lives only here.
  const [notYet, setNotYet] = useState(false);
  const { query, online } = useRestEstimate(night);
  const latest = queryClient.getQueryData<RestEstimate | null>(restEstimateKey(null))?.night;
  const estimate = query.data ?? null;

  const go = (delta: number) => {
    if (!estimate) return;
    const next = shiftNight(estimate.night, delta);
    setNight(latest && next >= latest ? null : next);
  };
  const atLatest = night === null;

  let body;
  if (estimate) {
    body = <Parts estimate={estimate} />;
  } else if (query.isError) {
    body = (
      <Alert
        severity="error"
        action={<Button onClick={() => void query.refetch()}>{t('common.reload')}</Button>}
      >
        {t('rest.error')}
      </Alert>
    );
  } else if (!online) {
    body = <Typography color="text.secondary">{t('rest.offline.none')}</Typography>;
  } else {
    body = (
      <Box role="status" aria-busy="true" aria-label={t('common.loading')}>
        <Skeleton variant="rounded" height={48} />
      </Box>
    );
  }

  return (
    <Stack spacing={2}>
      <Card component="section" aria-labelledby="rest-last-night" sx={{ p: 2.5 }}>
        <Stack
          direction="row"
          sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 1, mb: 1 }}
        >
          <Button
            aria-label={t('rest.night.previous')}
            disabled={!estimate}
            onClick={() => go(-1)}
            sx={NAV_BUTTON}
          >
            <Icon name="chevron-left" size={20} />
          </Button>
          <Typography id="rest-last-night" variant="h6" component="h2" sx={{ textAlign: 'center' }}>
            {estimate
              ? t('rest.night.of', { date: formatDate(estimate.night, 'weekdayDayMonth') })
              : t('rest.night.last')}
          </Typography>
          <Button
            aria-label={t('rest.night.next')}
            disabled={!estimate || atLatest}
            onClick={() => go(1)}
            sx={NAV_BUTTON}
          >
            <Icon name="chevron-right" size={20} />
          </Button>
        </Stack>
        {body}
        {!online && estimate && (
          <Alert severity="info" sx={{ mt: 1.5 }}>
            {t('rest.offline.last')}
          </Alert>
        )}
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
          {t('rest.disclaimer')}
        </Typography>
      </Card>
      {estimate?.askMorning && !notYet && online && (
        <MorningQuestion night={estimate.night} onNotYet={() => setNotYet(true)} />
      )}
    </Stack>
  );
}
