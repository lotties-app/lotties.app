import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Typography } from '@mui/material';
import { useSearchParams } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiClientContext } from '../api/ApiClientContext';
import { DataLocationScreen } from '../byoDatabase/DataLocationScreen';
import type { DataStoreStatus, DataStoreView } from '../byoDatabase/dataStoreApi';
import type { Baby } from '../db/models';
import { fakeApi, httpError } from '../test/fakeApi';
import { PreviewToolbar } from './PreviewToolbar';

/*
 * Developer-only (route `/dev/data-location`, never in production builds): Settings > Where your
 * data lives (docs/design/47-bring-your-own-database.md) over an in-memory API, synthetic baby
 * "Lia". `?state=hosted` (the choice; "Set up my own database" opens the wizard, whose "Save and
 * test" answers ok), `saved` (a tested database, records still hosted), `own` (records in the
 * family's database, working), `paused` (unreachable), `credentials` (password refused). No
 * sign-in, no server, no real database.
 */

const SCENARIOS = ['hosted', 'saved', 'own', 'paused', 'credentials'] as const;
type Scenario = (typeof SCENARIOS)[number];

const BABY: Baby = { id: 'dev-data-location', name: 'Lia', birthDate: '2026-08-01', role: 'Owner' };
const CHECKED = '2026-11-07T09:30:00Z';

const store = (overrides: Partial<DataStoreStatus>): DataStoreStatus => ({
  state: 'ready',
  providerLabel: 'Supabase',
  hasDescriptor: true,
  schemaVersion: '1',
  lastCheckedAt: CHECKED,
  lastCheckResult: 'ok',
  updatedAt: CHECKED,
  ...overrides,
});

const VIEWS: Record<Scenario, DataStoreView> = {
  hosted: { kind: 'hosted', store: null },
  saved: { kind: 'hosted', store: store({ state: 'pending', schemaVersion: null }) },
  own: { kind: 'own', store: store({}) },
  paused: {
    kind: 'own',
    store: store({ state: 'unreachable', lastCheckResult: 'store_paused_or_unreachable' }),
  },
  credentials: {
    kind: 'own',
    store: store({ state: 'unreachable', lastCheckResult: 'store_credentials_rejected' }),
  },
};

function previewApi(scenario: Scenario) {
  return fakeApi((call) => {
    if (!call.path.includes('/data-store') && !call.path.includes('/consents/')) return undefined;
    if (call.path.endsWith('/test')) {
      return { ok: true, result: 'ok', findings: [], checkedAt: CHECKED };
    }
    if (call.path.endsWith('/move-in') || call.path.endsWith('/move-out')) {
      throw httpError(501, 'not_implemented');
    }
    if (call.path.includes('/consents/')) return { optional: {} };
    if (call.method === 'DELETE') return null;
    return VIEWS[scenario];
  }).api;
}

/** One scenario: its own in-memory API and query cache (remounted when the scenario changes). */
function ScenarioScreen({ scenario }: { scenario: Scenario }) {
  const [api] = useState(() => previewApi(scenario));
  const [queries] = useState(() => new QueryClient());
  return (
    <ApiClientContext value={api}>
      <QueryClientProvider client={queries}>
        <DataLocationScreen baby={BABY} />
      </QueryClientProvider>
    </ApiClientContext>
  );
}

/** Developer-only: the "Where your data lives" screen with synthetic answers. */
export default function DataLocationPreview() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const requested = params.get('state');
  const scenario: Scenario = SCENARIOS.find((s) => s === requested) ?? 'hosted';
  return (
    <Box sx={{ bgcolor: 'background.default', color: 'text.primary', minHeight: '100dvh' }}>
      <Box
        sx={{
          maxWidth: 480,
          mx: 'auto',
          px: 2,
          pt: 2,
          pb: 4,
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr)',
          gap: 2,
        }}
      >
        <Typography variant="h5" component="h1">
          {t('byoDatabase.title')}
        </Typography>
        <ScenarioScreen key={scenario} scenario={scenario} />
        <PreviewToolbar
          scenarios={SCENARIOS}
          scenario={scenario}
          onScenario={(next) => setParams({ state: next }, { replace: true })}
        />
      </Box>
    </Box>
  );
}
