import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Box, Button, Card, Skeleton, Stack, Typography } from '@mui/material';
import { SegmentedControl } from '../ui/form';
import { HISTORY_NIGHTS, type HistoryNights, type RestHistory } from './restApi';
import { readHistoryNights, writeHistoryNights } from './restHistoryModel';
import { RestNightsChart } from './RestNightsChart';
import { RestTypicalCharts } from './RestTypicalCharts';
import { useRestHistory } from './useRest';

/*
 * History of the person's own estimated rest (docs/design/41-caregiver-rest.md section 12), below
 * the last-night card. Like that card it is online-only: offline it keeps showing the last answer in
 * the memory cache, marked as such. The 14 / 28 choice is the only thing remembered on the device.
 */

function HistoryBody({ history }: { history: RestHistory }) {
  const { t } = useTranslation();
  if (history.status === 'disabled') return <Typography>{t('rest.status.disabled')}</Typography>;
  return (
    <Stack spacing={3}>
      <RestNightsChart nights={history.nights} />
      <RestTypicalCharts history={history} />
    </Stack>
  );
}

export function RestHistorySection() {
  const { t } = useTranslation();
  const [nights, setNights] = useState<HistoryNights>(readHistoryNights);
  const { query, online } = useRestHistory(nights);
  const history = query.data;

  // The server does not know the route (older API): no section at all.
  if (history === null) return null;

  const choose = (next: HistoryNights | null) => {
    if (!next || next === nights) return;
    setNights(next);
    writeHistoryNights(next);
  };

  let body;
  if (history) {
    body = <HistoryBody history={history} />;
  } else if (query.isError) {
    body = (
      <Alert
        severity="error"
        action={<Button onClick={() => void query.refetch()}>{t('common.reload')}</Button>}
      >
        {t('rest.history.error')}
      </Alert>
    );
  } else if (!online) {
    body = <Typography color="text.secondary">{t('rest.history.offlineNone')}</Typography>;
  } else {
    body = (
      <Box role="status" aria-busy="true" aria-label={t('common.loading')}>
        <Skeleton variant="rounded" height={160} />
      </Box>
    );
  }

  return (
    <Card component="section" aria-labelledby="rest-history" sx={{ p: 2.5 }}>
      <Typography id="rest-history" variant="h6" component="h2">
        {t('rest.history.title')}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
        {t('rest.history.intro')}
      </Typography>
      <Box sx={{ mb: 2, '& [role="radio"]': { minHeight: 44 } }}>
        <SegmentedControl<`${HistoryNights}`>
          aria-label={t('rest.history.nightsLabel')}
          value={`${nights}`}
          options={HISTORY_NIGHTS.map((n) => ({
            value: `${n}` as const,
            label: t('rest.history.nights', { count: n }),
          }))}
          onChange={(value) => choose(value ? (Number(value) as HistoryNights) : null)}
        />
      </Box>
      {body}
      {!online && history && (
        <Alert severity="info" sx={{ mt: 1.5 }}>
          {t('rest.offline.last')}
        </Alert>
      )}
      <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
        {t('rest.disclaimer')}
      </Typography>
    </Card>
  );
}
