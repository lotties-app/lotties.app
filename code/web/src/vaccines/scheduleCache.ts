import type { ApiClient } from '../api/apiClient';
import type { BabyRoutineDb } from '../db/database';
import type { VaccineScheduleCache } from '../db/models';
import { apiPaths } from '../sync/contract';
import { SUPPORTED_SCHEMA_VERSION, type VaccineSchedule } from './vaccineSchedule';

/*
 * The vaccine schedule on the device (docs/design/18-vaccines.md): the API serves one schedule for
 * everybody (`GET /vaccine-schedule` with an `ETag`); the device keeps the last copy in Dexie and
 * works from it offline. Online it asks again at most once an hour with `If-None-Match`, so an
 * unchanged schedule costs a 304 and no body.
 */

/** The only schedule profile there is today. */
export const SCHEDULE_PROFILE = 'BR';

/** The server is asked again at most this often (the schedule changes a few times a year). */
export const SCHEDULE_CHECK_MS = 60 * 60_000;

export type ScheduleRefresh =
  /** A newer schedule was stored. */
  | 'updated'
  /** The server said the cached one is current (or sent the same content). */
  | 'unchanged'
  /** The cached one was checked less than an hour ago. */
  | 'skipped'
  /** The answer was not a schedule this app reads (a newer schema, or not a schedule): the cache stays. */
  | 'unsupported'
  /** Offline or a server problem: the cache stays. */
  | 'failed';

/** Whether `value` looks like a schedule of the schema this app reads. */
export function isReadableSchedule(value: unknown): value is VaccineSchedule {
  const schedule = value as Partial<VaccineSchedule> | null | undefined;
  return (
    typeof schedule === 'object' &&
    schedule !== null &&
    schedule.schemaVersion === SUPPORTED_SCHEMA_VERSION &&
    Array.isArray(schedule.doses) &&
    Array.isArray(schedule.vaccines) &&
    Array.isArray(schedule.sources)
  );
}

export function readCachedSchedule(db: BabyRoutineDb): Promise<VaccineScheduleCache | undefined> {
  return db.vaccineSchedules.get(SCHEDULE_PROFILE);
}

const inFlight = new WeakMap<BabyRoutineDb, Promise<ScheduleRefresh>>();

async function fetchSchedule(
  db: BabyRoutineDb,
  api: ApiClient,
  now: number,
): Promise<ScheduleRefresh> {
  const cached = await readCachedSchedule(db);
  const checkedAt = cached ? Date.parse(cached.checkedAt) : Number.NaN;
  if (cached && Number.isFinite(checkedAt) && now - checkedAt < SCHEDULE_CHECK_MS) return 'skipped';
  const stamp = new Date(now).toISOString();
  try {
    const { status, data, headers } = await api.requestWithMeta<unknown>(
      apiPaths.vaccineSchedule(),
      {
        ...(cached?.etag ? { headers: { 'If-None-Match': cached.etag } } : {}),
        skipUnauthorizedHandler: true,
      },
    );
    if (status === 304 && cached) {
      await db.vaccineSchedules.put({ ...cached, checkedAt: stamp });
      return 'unchanged';
    }
    if (!isReadableSchedule(data)) return 'unsupported';
    const etag = headers.get('ETag');
    const same = cached !== undefined && etag !== null && etag === cached.etag;
    await db.vaccineSchedules.put({
      profile: SCHEDULE_PROFILE,
      etag,
      schedule: data,
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
 * Asks the server for the schedule unless the cached one was checked within the hour. Never throws;
 * a second call while one runs shares it (the Now card and the page open together).
 */
export function refreshVaccineSchedule(
  db: BabyRoutineDb,
  api: ApiClient,
  now: number = Date.now(),
): Promise<ScheduleRefresh> {
  const running = inFlight.get(db);
  if (running) return running;
  const request = fetchSchedule(db, api, now).finally(() => inFlight.delete(db));
  inFlight.set(db, request);
  return request;
}
