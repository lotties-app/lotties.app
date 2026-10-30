import { screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BabyRoutineDb } from '../db/database';
import { SHIPPED_AGE_NORMS, seedAgeNorms } from '../test/ageNorms';
import { fakeApi, networkError, notModified, testDatabase, withHeaders } from '../test/fakeApi';
import { renderWithDb, settleSync } from '../test/renderApp';
import {
  AGE_NORMS_CHECK_MS,
  AGE_NORMS_KEY,
  readCachedAgeNorms,
  refreshAgeNorms,
} from './ageNormsCache';
import { useAgeNorms } from './useAgeNorms';

/*
 * The age norms cache (docs/design/28-age-norms.md): fetched once with its ETag, asked again at
 * most daily with If-None-Match (304: keep), replaced when the content changed, and always served
 * from the device so suggestions keep their priors offline.
 */

let db: BabyRoutineDb;
const T0 = Date.parse('2026-10-23T10:00:00.000Z');
const PATH = '/api/v1/age-norms';
const norms = (generatedAt = SHIPPED_AGE_NORMS.generatedAt) => ({
  ...SHIPPED_AGE_NORMS,
  generatedAt,
});

beforeEach(() => {
  db = testDatabase();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await settleSync();
  await db.delete();
});

describe('refreshAgeNorms', () => {
  it('stores the norms with their ETag the first time', async () => {
    const { api, calls } = fakeApi(() => withHeaders(norms(), { ETag: '"n-1"' }));

    expect(await refreshAgeNorms(db, api, T0)).toBe('updated');

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ method: 'GET', path: PATH, skipUnauthorizedHandler: true });
    expect(calls[0]?.headers).toBeUndefined();
    expect(await readCachedAgeNorms(db)).toMatchObject({
      key: AGE_NORMS_KEY,
      etag: '"n-1"',
      norms: { schemaVersion: 1 },
      fetchedAt: new Date(T0).toISOString(),
      checkedAt: new Date(T0).toISOString(),
    });
  });

  it('does not ask again within the day', async () => {
    await seedAgeNorms(db, norms(), '"n-1"', new Date(T0).toISOString());
    const { api, calls } = fakeApi();

    expect(await refreshAgeNorms(db, api, T0 + AGE_NORMS_CHECK_MS - 1)).toBe('skipped');
    expect(calls).toHaveLength(0);
  });

  it('asks with If-None-Match after a day and keeps the copy on a 304', async () => {
    await seedAgeNorms(db, norms(), '"n-1"', new Date(T0).toISOString());
    const later = T0 + AGE_NORMS_CHECK_MS + 1;
    const { api, calls } = fakeApi(() => notModified({ ETag: '"n-1"' }));

    expect(await refreshAgeNorms(db, api, later)).toBe('unchanged');

    expect(calls[0]?.headers).toEqual({ 'If-None-Match': '"n-1"' });
    const after = await readCachedAgeNorms(db);
    expect(after?.norms.generatedAt).toBe(SHIPPED_AGE_NORMS.generatedAt);
    expect(after?.fetchedAt).toBe(new Date(T0).toISOString());
    expect(after?.checkedAt).toBe(new Date(later).toISOString());
  });

  it('replaces the copy when the norms changed', async () => {
    await seedAgeNorms(db, norms(), '"n-1"', new Date(T0).toISOString());
    const later = T0 + AGE_NORMS_CHECK_MS + 1;
    const { api } = fakeApi(() => withHeaders(norms('2027-10-01'), { ETag: '"n-2"' }));

    expect(await refreshAgeNorms(db, api, later)).toBe('updated');

    expect(await readCachedAgeNorms(db)).toMatchObject({
      etag: '"n-2"',
      norms: { generatedAt: '2027-10-01' },
      fetchedAt: new Date(later).toISOString(),
    });
  });

  it('keeps the copy when the device is offline or the server fails', async () => {
    await seedAgeNorms(db, norms(), '"n-1"', new Date(T0).toISOString());
    const before = await readCachedAgeNorms(db);
    const later = T0 + AGE_NORMS_CHECK_MS + 1;

    for (const failure of [networkError(), new Error('boom')]) {
      const { api } = fakeApi(() => {
        throw failure;
      });
      expect(await refreshAgeNorms(db, api, later)).toBe('failed');
    }

    expect(await readCachedAgeNorms(db)).toEqual(before);
  });

  it('ignores an answer that is not norms of this schema', async () => {
    await seedAgeNorms(db, norms(), '"n-1"', new Date(T0).toISOString());
    const before = await readCachedAgeNorms(db);
    const later = T0 + AGE_NORMS_CHECK_MS + 1;

    for (const answer of [{ ...norms(), schemaVersion: 2 }, [], { schemaVersion: 1 }]) {
      const { api } = fakeApi(() => withHeaders(answer, { ETag: '"x"' }));
      expect(await refreshAgeNorms(db, api, later)).toBe('unsupported');
    }

    expect(await readCachedAgeNorms(db)).toEqual(before);
  });

  it('shares one request between callers that ask at the same time', async () => {
    const { api, calls } = fakeApi(() => withHeaders(norms(), { ETag: '"n-1"' }));

    await Promise.all([
      refreshAgeNorms(db, api, T0),
      refreshAgeNorms(db, api, T0),
      refreshAgeNorms(db, api, T0),
    ]);

    expect(calls).toHaveLength(1);
  });
});

function Probe() {
  const current = useAgeNorms();
  if (current === undefined) return <p>loading</p>;
  return <p>{current === null ? 'none' : `${current.norms.length} norms`}</p>;
}

describe('useAgeNorms', () => {
  const count = `${SHIPPED_AGE_NORMS.norms.length} norms`;

  it('reads the copy on the device without asking the server again within the day', async () => {
    await seedAgeNorms(db);
    const { api, calls } = fakeApi();

    renderWithDb(db, <Probe />, { api });

    expect(await screen.findByText(count)).toBeTruthy();
    expect(calls.filter((call) => call.path === PATH)).toHaveLength(0);
  });

  it('works offline from the copy and does not ask the server', async () => {
    await seedAgeNorms(db);
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
    const { api, calls } = fakeApi();

    renderWithDb(db, <Probe />, { api });

    expect(await screen.findByText(count)).toBeTruthy();
    expect(calls).toHaveLength(0);
  });

  it('has no norms on a first run offline (callers keep their defaults)', async () => {
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
    renderWithDb(db, <Probe />, { api: fakeApi().api });
    expect(await screen.findByText('none')).toBeTruthy();
  });

  it('downloads the norms on a first run online', async () => {
    const { api, calls } = fakeApi((call) =>
      call.path === PATH ? withHeaders(norms(), { ETag: '"n-1"' }) : undefined,
    );

    renderWithDb(db, <Probe />, { api });

    await waitFor(() => expect(screen.getByText(count)).toBeTruthy());
    expect(calls.filter((call) => call.path === PATH)).toHaveLength(1);
    expect((await readCachedAgeNorms(db))?.etag).toBe('"n-1"');
  });
});
