import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useApiClient } from '../api/ApiClientContext';
import { setOptionalConsent } from '../consent/consentApi';
import { useLocale } from '../i18n/useLocale';
import {
  dataStoreQueryKey,
  saveDataStore,
  testDataStore,
  type DataStoreTestResult,
  type SaveDataStoreRequest,
} from './dataStoreApi';
import { errorMessageOf, retryAfterSecondsOf, type ResultMessage } from './storeMessages';

export type SavePhase =
  | { kind: 'idle' }
  | { kind: 'busy' }
  /** Nothing was saved: the fields (and passwords) stay so the person can fix them. */
  | { kind: 'saveFailed'; message: ResultMessage }
  /** Saved; the test answered (ok or a coarse code). */
  | { kind: 'tested'; result: DataStoreTestResult }
  /**
   * Saved; the test request itself failed: a store that is down for now (503 `store_*` with
   * `Retry-After`), the rate limit, offline... `retryAfterSeconds` when the server said when.
   */
  | { kind: 'testFailed'; message: ResultMessage; retryAfterSeconds: number | null };

/**
 * The only network calls of the setup wizard, in the order the server needs (docs/design/47
 * section 3.4 and API task T6): the optional consent `byo_database`, then `PUT /data-store`, then
 * `POST /data-store/test`. `onSaved` runs as soon as the server holds the details (the wizard
 * forgets the passwords there).
 */
export function useSaveAndTest(babyId: string, onSaved: () => void) {
  const api = useApiClient();
  const queryClient = useQueryClient();
  const { locale } = useLocale();
  const [phase, setPhase] = useState<SavePhase>({ kind: 'idle' });

  const refresh = () => queryClient.invalidateQueries({ queryKey: dataStoreQueryKey(babyId) });

  const test = async () => {
    setPhase({ kind: 'busy' });
    try {
      setPhase({ kind: 'tested', result: await testDataStore(api, babyId) });
    } catch (error) {
      setPhase({
        kind: 'testFailed',
        message: errorMessageOf(error),
        retryAfterSeconds: retryAfterSecondsOf(error),
      });
    }
    await refresh();
  };

  const saveAndTest = async (request: SaveDataStoreRequest) => {
    setPhase({ kind: 'busy' });
    try {
      await setOptionalConsent(api, 'byo_database', true, locale);
      await saveDataStore(api, babyId, request);
    } catch (error) {
      setPhase({ kind: 'saveFailed', message: errorMessageOf(error) });
      return;
    }
    onSaved();
    await test();
  };

  const reset = () => setPhase({ kind: 'idle' });

  return { phase, saveAndTest, test, reset };
}
