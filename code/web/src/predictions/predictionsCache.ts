import type { PredictionsDto } from '../sync/contract';
import { widgetInputsChanged } from '../widgets/widgetInputs';

/** Last predictions response per baby, kept so the cards can show something offline. */
export interface CachedPredictions {
  data: PredictionsDto;
  /** Epoch ms of the fetch. */
  fetchedAt: number;
}

const PREFIX = 'baby-routine.predictions.';
const keyFor = (babyId: string) => `${PREFIX}${babyId}`;

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
  // The home-screen widget shows the estimates built from these predictions.
  widgetInputsChanged();
}

/** Drops the cached predictions of every baby (sign-out, account switch). */
export function clearAllCachedPredictions(): void {
  try {
    const storage = window.localStorage;
    const keys = Array.from({ length: storage.length }, (_, i) => storage.key(i));
    for (const key of keys) if (key?.startsWith(PREFIX)) storage.removeItem(key);
  } catch {
    // Storage unavailable: nothing to clear.
  }
}

export function clearCachedPredictions(babyId: string): void {
  try {
    window.localStorage.removeItem(keyFor(babyId));
  } catch {
    // Storage unavailable: nothing to clear.
  }
}
