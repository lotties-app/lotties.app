import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ReactNode } from 'react';
import { ApiClientContext } from '../api/ApiClientContext';
import { AuthContext } from '../auth/AuthContext';
import type { BabyRoutineDb } from '../db/database';
import { DatabaseProvider } from '../db/DatabaseProvider';
import { useBabies } from '../db/hooks';
import { fakeAuth } from '../test/fakeAuth';
import { fakeApi, testDatabase } from '../test/fakeApi';
import { useSyncStatus } from './SyncEngineContext';
import { SyncProvider } from './SyncProvider';

let db: BabyRoutineDb;

beforeEach(() => {
  db = testDatabase();
});

afterEach(async () => {
  await db.delete();
});

function Probe() {
  const status = useSyncStatus();
  const babies = useBabies();
  return (
    <p>
      {status.state}:{status.pendingCount}:{babies?.map((b) => b.name).join(',') ?? 'loading'}
    </p>
  );
}

function renderWith(isAuthenticated: boolean, children: ReactNode, enabled = true) {
  const fake = fakeApi();
  render(
    <AuthContext value={fakeAuth({ isAuthenticated })}>
      <ApiClientContext value={fake.api}>
        <DatabaseProvider db={db}>
          <SyncProvider options={{ locks: null, isOnline: () => true }} enabled={enabled}>
            {children}
          </SyncProvider>
        </DatabaseProvider>
      </ApiClientContext>
    </AuthContext>,
  );
  return fake;
}

describe('SyncProvider', () => {
  it('starts syncing when authenticated and exposes status and live data', async () => {
    const { calls } = renderWith(true, <Probe />);

    expect(await screen.findByText('idle:0:Lia')).toBeTruthy();
    expect(calls.some((c) => c.path === '/api/v1/babies')).toBe(true);
  });

  it('does not sync while signed out', async () => {
    const { calls } = renderWith(false, <Probe />);

    expect(await screen.findByText('idle:0:')).toBeTruthy();
    expect(calls).toHaveLength(0);
  });

  it('does not sync while it is disabled (no current consent: the server would refuse every baby route)', async () => {
    const { calls } = renderWith(true, <Probe />, false);

    expect(await screen.findByText('idle:0:')).toBeTruthy();
    expect(calls).toHaveLength(0);
  });
});
