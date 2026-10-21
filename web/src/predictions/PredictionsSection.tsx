import { useTranslation } from 'react-i18next';
import { Stack, Typography } from '@mui/material';
import type { Baby, EventType } from '../db/models';
import { useNow } from '../events/time';
import { formatList } from '../i18n/format';
import { t } from '../i18n/i18n';
import type { PredictionsDto } from '../sync/contract';
import { PredictionCard } from './PredictionCard';
import { clockWithDay, typeForKey, typeNameForKey } from './predictionModel';
import { usePredictions } from './usePredictions';

/** Overdue marks only need minute precision. */
const CLOCK_TICK_MS = 30_000;

interface Props {
  baby: Baby;
  types: EventType[];
}

function StatusLine({ children }: { children: string }) {
  return (
    <Typography variant="body2" color="text.secondary">
      {children}
    </Typography>
  );
}

function placeholderMessage(online: boolean, isError: boolean): string {
  if (!online) return t('predictions.offline');
  return isError ? t('predictions.unavailable') : t('predictions.loading');
}

function updatedAtMessage(online: boolean, updatedAt: number): string {
  const when = clockWithDay(new Date(updatedAt).toISOString(), new Date());
  return online
    ? t('predictions.lastUpdated', { when })
    : t('predictions.lastUpdatedOffline', { when });
}

function PredictionList({ data, baby, types }: Props & { data: PredictionsDto }) {
  useTranslation();
  const now = new Date(useNow(CLOCK_TICK_MS));
  const nameOf = (key: string) => typeNameForKey(types, key, baby.id);
  if (data.predictions.length === 0 && data.insufficientData.length === 0) {
    return <StatusLine>{t('predictions.empty')}</StatusLine>;
  }
  return (
    <>
      {data.predictions.map((p) => (
        <PredictionCard
          key={p.typeKey}
          prediction={p}
          type={typeForKey(types, p.typeKey, baby.id)}
          name={nameOf(p.typeKey)}
          now={now}
        />
      ))}
      {data.insufficientData.length > 0 && (
        <StatusLine>
          {t('predictions.needMore', {
            names: formatList(data.insufficientData.map((m) => nameOf(m.typeKey))),
          })}
        </StatusLine>
      )}
    </>
  );
}

/** "Next predicted" cards. Estimates only: never presented as medical advice. */
export function PredictionsSection({ baby, types }: Props) {
  useTranslation();
  const { query, online } = usePredictions(baby.id);
  const { data, isError, dataUpdatedAt } = query;
  const showUpdatedAt = !!data && (!online || isError) && dataUpdatedAt > 0;

  return (
    <Stack spacing={1} component="section" aria-label={t('predictions.region')}>
      <Typography variant="h6" component="h2">
        {t('predictions.title')}
      </Typography>
      {data ? (
        <PredictionList data={data} baby={baby} types={types} />
      ) : (
        <StatusLine>{placeholderMessage(online, isError)}</StatusLine>
      )}
      {showUpdatedAt && <StatusLine>{updatedAtMessage(online, dataUpdatedAt)}</StatusLine>}
      <Typography variant="caption" color="text.secondary">
        {t('predictions.disclaimer')}
      </Typography>
    </Stack>
  );
}
