import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import type { ApiClient } from '../api/apiClient';
import { ApiClientContext } from '../api/ApiClientContext';
import { AuthContext, type AuthApi } from '../auth/AuthContext';
import { SelectedBabyProvider } from '../baby/SelectedBabyProvider';
import type { BabyRoutineDb } from '../db/database';
import { DatabaseProvider } from '../db/DatabaseProvider';
import { I18nProvider } from '../i18n/I18nProvider';
import { AppThemeProvider } from '../theme/AppThemeProvider';
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
  /** Initial router location. */
  route?: string;
}

export function testQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

let lastEngine: SyncEngine | null = null;

/** Waits for fire-and-forget syncs started by the last render (call before deleting the db). */
export async function settleSync(): Promise<void> {
  await lastEngine?.whenIdle();
}

/** Renders `ui` with the app's data providers and a memory router (no real network). */
export function renderWithDb(db: BabyRoutineDb, ui: ReactNode, options: RenderOptions = {}) {
  const api = options.api ?? fakeApi().api;
  const engine = options.engine ?? new SyncEngine({ db, api, locks: null, eventTarget: null });
  lastEngine = engine;
  return render(
    <I18nProvider>
      <AppThemeProvider>
        <AuthContext value={options.auth ?? fakeAuth()}>
          <ApiClientContext value={api}>
            <QueryClientProvider client={testQueryClient()}>
              <DatabaseProvider db={db}>
                <SyncEngineContext value={engine}>
                  <MemoryRouter initialEntries={[options.route ?? '/']}>
                    <SelectedBabyProvider>{ui}</SelectedBabyProvider>
                  </MemoryRouter>
                </SyncEngineContext>
              </DatabaseProvider>
            </QueryClientProvider>
          </ApiClientContext>
        </AuthContext>
      </AppThemeProvider>
    </I18nProvider>,
  );
}
