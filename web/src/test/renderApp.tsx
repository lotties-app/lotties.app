import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { ApiClient } from '../api/apiClient';
import { ApiClientContext } from '../api/ApiClientContext';
import { AuthContext, type AuthApi } from '../auth/AuthContext';
import { SelectedBabyProvider } from '../baby/SelectedBabyProvider';
import type { BabyRoutineDb } from '../db/database';
import { DatabaseProvider } from '../db/DatabaseProvider';
import { SyncEngine } from '../sync/SyncEngine';
import { SyncEngineContext } from '../sync/SyncEngineContext';
import { fakeApi } from './fakeApi';
import { fakeAuth } from './fakeAuth';

export interface RenderOptions {
  /** Defaults to a `fakeApi()` with default responses. */
  api?: ApiClient;
  /** Defaults to an engine that is never started (initial idle status). */
  engine?: SyncEngine;
  auth?: AuthApi;
}

export function testQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

/** Renders `ui` with the app's data providers (no router, no real network). */
export function renderWithDb(db: BabyRoutineDb, ui: ReactNode, options: RenderOptions = {}) {
  const api = options.api ?? fakeApi().api;
  const engine = options.engine ?? new SyncEngine({ db, api, locks: null, eventTarget: null });
  return render(
    <AuthContext value={options.auth ?? fakeAuth()}>
      <ApiClientContext value={api}>
        <QueryClientProvider client={testQueryClient()}>
          <DatabaseProvider db={db}>
            <SyncEngineContext value={engine}>
              <SelectedBabyProvider>{ui}</SelectedBabyProvider>
            </SyncEngineContext>
          </DatabaseProvider>
        </QueryClientProvider>
      </ApiClientContext>
    </AuthContext>,
  );
}
