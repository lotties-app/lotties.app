import type { PredictionsDto } from '../sync/contract';

/** Last predictions response per baby, kept so the cards can show something offline. */
export interface CachedPredictions {
  data: PredictionsDto;
  /** Epoch ms of the fetch. */
  fetchedAt: number;
}

const keyFor = (babyId: string) => `baby-routine.predictions.${babyId}`;

function isCached(value: unknown): value is CachedPredictions {
  const v = value as Partial<CachedPredictions> | null;
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof v.fetchedAt === 'number' &&
    Array.isArray(v.data?.predictions) &&
    Array.isArray(v.data?.insufficientData)
  );
}

export function readCachedPredictions(babyId: string): CachedPredictions | undefined {
  try {
    const raw = window.localStorage.getItem(keyFor(babyId));
    const parsed: unknown = raw ? JSON.parse(raw) : undefined;
    return isCached(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function writeCachedPredictions(babyId: string, cached: CachedPredictions): void {
  try {
    window.localStorage.setItem(keyFor(babyId), JSON.stringify(cached));
  } catch {
    // Storage unavailable or full: the cards just have no offline copy.
  }
}
