import { Stack, Typography } from '@mui/material';
import type { Baby, EventType } from '../db/models';
import { useNow } from '../events/time';
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
  if (!online) return 'Predictions load when you are back online.';
  return isError ? 'Predictions are unavailable right now.' : 'Loading predictions…';
}

function updatedAtMessage(online: boolean, updatedAt: number): string {
  const when = clockWithDay(new Date(updatedAt).toISOString(), new Date());
  return `${online ? '' : 'Offline · '}Last updated ${when}`;
}

function PredictionList({ data, baby, types }: Props & { data: PredictionsDto }) {
  const now = new Date(useNow(CLOCK_TICK_MS));
  const nameOf = (key: string) => typeNameForKey(types, key, baby.id);
  if (data.predictions.length === 0 && data.insufficientData.length === 0) {
    return <StatusLine>Predictions appear after a few days of logging.</StatusLine>;
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
          {`Need more data for: ${data.insufficientData.map((m) => nameOf(m.typeKey)).join(', ')}`}
        </StatusLine>
      )}
    </>
  );
}

/** "Next predicted" cards. Estimates only: never presented as medical advice. */
export function PredictionsSection({ baby, types }: Props) {
  const { query, online } = usePredictions(baby.id);
  const { data, isError, dataUpdatedAt } = query;
  const showUpdatedAt = !!data && (!online || isError) && dataUpdatedAt > 0;

  return (
    <Stack spacing={1} component="section" aria-label="Predictions">
      <Typography variant="h6" component="h2">
        Next predicted
      </Typography>
      {data ? (
        <PredictionList data={data} baby={baby} types={types} />
      ) : (
        <StatusLine>{placeholderMessage(online, isError)}</StatusLine>
      )}
      {showUpdatedAt && <StatusLine>{updatedAtMessage(online, dataUpdatedAt)}</StatusLine>}
      <Typography variant="caption" color="text.secondary">
        Estimates from your logged history, not medical advice.
      </Typography>
    </Stack>
  );
}
