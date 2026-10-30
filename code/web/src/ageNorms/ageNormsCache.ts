import type { ApiClient } from '../api/apiClient';
import type { BabyRoutineDb } from '../db/database';
import type { AgeNormsCache } from '../db/models';
import { apiPaths } from '../sync/contract';
import { isReadableAgeNorms } from './ageNorms';

/*
 * The age norms on the device (docs/design/28-age-norms.md), cached like the vaccine schedule
 * (vaccines/scheduleCache.ts): the API serves one file for everybody (`GET /age-norms` with an
 * `ETag`); the device keeps the last copy in Dexie and works from it offline. Online it asks again
 * at most once a day with `If-None-Match`, so an unchanged file costs a 304 and no body. Without a
 * copy (first run offline) every caller keeps its built-in defaults.
 */

/** The one row's key. */
export const AGE_NORMS_KEY = 'current';

/** The server is asked again at most this often (the norms change about once a year). */
export const AGE_NORMS_CHECK_MS = 24 * 60 * 60_000;

export type AgeNormsRefresh = 'updated' | 'unchanged' | 'skipped' | 'unsupported' | 'failed';

export function readCachedAgeNorms(db: BabyRoutineDb): Promise<AgeNormsCache | undefined> {
  return db.ageNorms.get(AGE_NORMS_KEY);
}

const inFlight = new WeakMap<BabyRoutineDb, Promise<AgeNormsRefresh>>();

async function fetchAgeNorms(
  db: BabyRoutineDb,
  api: ApiClient,
  now: number,
): Promise<AgeNormsRefresh> {
  const cached = await readCachedAgeNorms(db);
  const checkedAt = cached ? Date.parse(cached.checkedAt) : Number.NaN;
  if (cached && Number.isFinite(checkedAt) && now - checkedAt < AGE_NORMS_CHECK_MS) {
    return 'skipped';
  }
  const stamp = new Date(now).toISOString();
  try {
    const { status, data, headers } = await api.requestWithMeta<unknown>(apiPaths.ageNorms(), {
      ...(cached?.etag ? { headers: { 'If-None-Match': cached.etag } } : {}),
      skipUnauthorizedHandler: true,
    });
    if (status === 304 && cached) {
      await db.ageNorms.put({ ...cached, checkedAt: stamp });
      return 'unchanged';
    }
    if (!isReadableAgeNorms(data)) return 'unsupported';
    const etag = headers.get('ETag');
    const same = cached !== undefined && etag !== null && etag === cached.etag;
    await db.ageNorms.put({
      key: AGE_NORMS_KEY,
      etag,
      norms: data,
      fetchedAt: same ? cached.fetchedAt : stamp,
      checkedAt: stamp,
    });
    return same ? 'unchanged' : 'updated';
  } catch {
    // Offline, signed out or a server problem: the copy on the device keeps serving.
    return 'failed';
  }
}

/**
 * Asks the server for the norms unless the cached copy was checked within the day. Never throws;
 * a second call while one runs shares it.
 */
export function refreshAgeNorms(
  db: BabyRoutineDb,
  api: ApiClient,
  now: number = Date.now(),
): Promise<AgeNormsRefresh> {
  const running = inFlight.get(db);
  if (running) return running;
  const request = fetchAgeNorms(db, api, now).finally(() => inFlight.delete(db));
  inFlight.set(db, request);
  return request;
}
