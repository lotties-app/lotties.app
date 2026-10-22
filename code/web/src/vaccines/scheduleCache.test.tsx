import { screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BabyRoutineDb } from '../db/database';
import { fakeApi, networkError, notModified, testDatabase, withHeaders } from '../test/fakeApi';
import { renderWithDb, settleSync } from '../test/renderApp';
import { TEST_SCHEDULE, seedSchedule } from '../test/vaccineSchedule';
import {
  SCHEDULE_CHECK_MS,
  SCHEDULE_PROFILE,
  isReadableSchedule,
  readCachedSchedule,
  refreshVaccineSchedule,
} from './scheduleCache';
import { useVaccineSchedule } from './useVaccineSchedule';

/*
 * The vaccine schedule cache (docs/design/18-vaccines.md section 2): fetched once with its ETag,
 * asked again at most hourly with If-None-Match (304: keep), replaced when the content changed,
 * and always served from the device so the page works offline.
 */

let db: BabyRoutineDb;
const T0 = Date.parse('2026-10-22T10:00:00.000Z');
const PATH = '/api/v1/vaccine-schedule';
const schedule = (profile = 'BR') => ({ ...TEST_SCHEDULE, profile });

beforeEach(() => {
  db = testDatabase();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await settleSync();
  await db.delete();
});

describe('refreshVaccineSchedule', () => {
  it('stores the schedule with its ETag the first time', async () => {
    const { api, calls } = fakeApi(() => withHeaders(schedule(), { ETag: '"br-1"' }));

    expect(await refreshVaccineSchedule(db, api, T0)).toBe('updated');

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ method: 'GET', path: PATH, skipUnauthorizedHandler: true });
    expect(calls[0]?.headers).toBeUndefined();
    expect(await readCachedSchedule(db)).toMatchObject({
      profile: SCHEDULE_PROFILE,
      etag: '"br-1"',
      schedule: { schemaVersion: 2 },
      fetchedAt: new Date(T0).toISOString(),
      checkedAt: new Date(T0).toISOString(),
    });
  });

  it('does not ask again within the hour', async () => {
    await seedSchedule(db);
    const stamp = await readCachedSchedule(db);
    const { api, calls } = fakeApi();

    const outcome = await refreshVaccineSchedule(
      db,
      api,
      Date.parse(stamp!.checkedAt) + SCHEDULE_CHECK_MS - 1,
    );

    expect(outcome).toBe('skipped');
    expect(calls).toHaveLength(0);
  });

  it('asks with If-None-Match after the hour and keeps the copy on a 304', async () => {
    await seedSchedule(db, schedule(), '"br-1"');
    const before = await readCachedSchedule(db);
    const later = Date.parse(before!.checkedAt) + SCHEDULE_CHECK_MS + 1;
    const { api, calls } = fakeApi(() => notModified({ ETag: '"br-1"' }));

    expect(await refreshVaccineSchedule(db, api, later)).toBe('unchanged');

    expect(calls[0]?.headers).toEqual({ 'If-None-Match': '"br-1"' });
    const after = await readCachedSchedule(db);
    expect(after?.schedule).toEqual(before?.schedule);
    expect(after?.fetchedAt).toBe(before?.fetchedAt);
    expect(after?.checkedAt).toBe(new Date(later).toISOString());
  });

  it('replaces the copy when the schedule changed', async () => {
    await seedSchedule(db, schedule(), '"br-1"');
    const before = await readCachedSchedule(db);
    const later = Date.parse(before!.checkedAt) + SCHEDULE_CHECK_MS + 1;
    const next = { ...schedule(), generatedOn: '2026-12-01' };
    const { api } = fakeApi(() => withHeaders(next, { ETag: '"br-2"' }));

    expect(await refreshVaccineSchedule(db, api, later)).toBe('updated');

    expect(await readCachedSchedule(db)).toMatchObject({
      etag: '"br-2"',
      schedule: { generatedOn: '2026-12-01' },
      fetchedAt: new Date(later).toISOString(),
    });
  });

  it('keeps the copy when the device is offline or the server fails', async () => {
    await seedSchedule(db);
    const before = await readCachedSchedule(db);
    const later = Date.parse(before!.checkedAt) + SCHEDULE_CHECK_MS + 1;

    for (const failure of [networkError(), new Error('boom')]) {
      const { api } = fakeApi(() => {
        throw failure;
      });
      expect(await refreshVaccineSchedule(db, api, later)).toBe('failed');
    }

    expect(await readCachedSchedule(db)).toEqual(before);
  });

  it('ignores an answer that is not a schedule of this schema', async () => {
    await seedSchedule(db);
    const before = await readCachedSchedule(db);
    const later = Date.parse(before!.checkedAt) + SCHEDULE_CHECK_MS + 1;

    for (const answer of [{ ...schedule(), schemaVersion: 3 }, [], { schemaVersion: 2 }]) {
      const { api } = fakeApi(() => withHeaders(answer, { ETag: '"x"' }));
      expect(await refreshVaccineSchedule(db, api, later)).toBe('unsupported');
    }

    expect(await readCachedSchedule(db)).toEqual(before);
    expect(isReadableSchedule(schedule())).toBe(true);
    expect(isReadableSchedule(null)).toBe(false);
  });

  it('shares one request between callers that ask at the same time', async () => {
    const { api, calls } = fakeApi(() => withHeaders(schedule(), { ETag: '"br-1"' }));

    await Promise.all([
      refreshVaccineSchedule(db, api, T0),
      refreshVaccineSchedule(db, api, T0),
      refreshVaccineSchedule(db, api, T0),
    ]);

    expect(calls).toHaveLength(1);
  });
});

function Probe() {
  const { schedule: current } = useVaccineSchedule();
  if (current === undefined) return <p>loading</p>;
  return <p>{current === null ? 'none' : `${current.vaccines.length} vaccines`}</p>;
}

describe('useVaccineSchedule', () => {
  it('reads the copy on the device first, without asking the server again within the hour', async () => {
    await seedSchedule(db);
    const { api, calls } = fakeApi();

    renderWithDb(db, <Probe />, { api });

    expect(await screen.findByText(`${TEST_SCHEDULE.vaccines.length} vaccines`)).toBeTruthy();
    expect(calls.filter((call) => call.path === PATH)).toHaveLength(0);
  });

  it('works offline from the copy and does not ask the server', async () => {
    await seedSchedule(db);
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
    const { api, calls } = fakeApi();

    renderWithDb(db, <Probe />, { api });

    expect(await screen.findByText(`${TEST_SCHEDULE.vaccines.length} vaccines`)).toBeTruthy();
    expect(calls).toHaveLength(0);
  });

  it('has no schedule on a first run offline', async () => {
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
    renderWithDb(db, <Probe />, { api: fakeApi().api });
    expect(await screen.findByText('none')).toBeTruthy();
  });

  it('downloads the schedule on a first run online and shows it', async () => {
    const { api, calls } = fakeApi((call) =>
      call.path === PATH ? withHeaders(schedule(), { ETag: '"br-1"' }) : undefined,
    );

    renderWithDb(db, <Probe />, { api });

    await waitFor(() =>
      expect(screen.getByText(`${TEST_SCHEDULE.vaccines.length} vaccines`)).toBeTruthy(),
    );
    expect(calls.filter((call) => call.path === PATH)).toHaveLength(1);
    expect((await readCachedSchedule(db))?.etag).toBe('"br-1"');
  });
});
