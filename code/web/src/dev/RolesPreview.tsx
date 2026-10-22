import { useState } from 'react';
import { Box, Typography } from '@mui/material';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ApiClient, RequestOptions } from '../api/apiClient';
import { ApiClientContext } from '../api/ApiClientContext';
import { createDatabase } from '../db/database';
import { DatabaseProvider } from '../db/DatabaseProvider';
import type { Baby } from '../db/models';
import { MembersSection } from '../settings/MembersSection';
import { SyncEngine } from '../sync/SyncEngine';
import { SyncEngineContext } from '../sync/SyncEngineContext';

/*
 * Developer-only (route `/dev/roles`, never in production builds): Settings > Members & invites as
 * the Owner sees it, with a Caregiver among the members and the invite role picker, on an
 * in-memory API (no sign-in, no server). Used for the Caregiver screenshots.
 */

const BABY: Baby = { id: 'dev-roles-baby', name: 'Lia', birthDate: '2026-08-01', role: 'Owner' };
const JOINED = '2026-10-01T10:00:00.000Z';
const MEMBERS = [
  { userId: 'dev-ana', displayName: 'Ana', role: 'Owner', joinedAt: '2026-08-01T10:00:00.000Z' },
  { userId: 'dev-rui', displayName: 'Rui', role: 'Parent', joinedAt: JOINED },
  { userId: 'dev-lu', displayName: 'Lu (grandma)', role: 'Caregiver', joinedAt: JOINED },
  { userId: 'dev-bia', displayName: 'Bia', role: 'Viewer', joinedAt: JOINED },
];
const INVITES = [
  {
    id: 'dev-invite',
    babyId: BABY.id,
    role: 'Caregiver',
    createdBy: 'dev-ana',
    createdAt: JOINED,
    expiresAt: '2026-12-30T10:00:00.000Z',
  },
];

/** Answers the members and invites calls from memory; writes succeed without changing anything. */
function previewApi(): ApiClient {
  const answer = (path: string, options?: RequestOptions): unknown => {
    if (options?.method && options.method !== 'GET') {
      return path.endsWith('/invites') ? { ...INVITES[0], token: 'preview-token' } : undefined;
    }
    if (path.endsWith('/members')) return MEMBERS;
    if (path.endsWith('/invites')) return INVITES;
    return [];
  };
  return {
    request: async <T,>(path: string, options?: RequestOptions) => answer(path, options) as T,
    requestWithMeta: async <T,>(path: string, options?: RequestOptions) => ({
      data: answer(path, options) as T,
      status: 200,
      headers: new Headers(),
    }),
  };
}

export default function RolesPreview() {
  const [setup] = useState(() => {
    const db = createDatabase('dev-roles-preview');
    const api = previewApi();
    return {
      db,
      api,
      engine: new SyncEngine({ db, api, locks: null, eventTarget: null }),
      queries: new QueryClient({
        defaultOptions: { queries: { retry: false, staleTime: Infinity } },
      }),
    };
  });
  return (
    <ApiClientContext value={setup.api}>
      <QueryClientProvider client={setup.queries}>
        <DatabaseProvider db={setup.db}>
          <SyncEngineContext value={setup.engine}>
            <Box sx={{ bgcolor: 'background.default', color: 'text.primary', minHeight: '100dvh' }}>
              <Box sx={{ maxWidth: 640, mx: 'auto', px: 2, py: 2 }}>
                <Typography variant="h5" component="h1" sx={{ pb: 2 }}>
                  Lia
                </Typography>
                <MembersSection baby={BABY} />
              </Box>
            </Box>
          </SyncEngineContext>
        </DatabaseProvider>
      </QueryClientProvider>
    </ApiClientContext>
  );
}
