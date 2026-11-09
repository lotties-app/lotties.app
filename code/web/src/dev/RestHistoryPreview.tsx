import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Typography } from '@mui/material';
import { useSearchParams } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiClientContext } from '../api/ApiClientContext';
import { RestHistorySection } from '../rest/RestHistorySection';
import { restHistoryFixture, type HistoryScenario } from '../rest/restHistoryFixtures';
import { fakeApi, httpError } from '../test/fakeApi';
import { PreviewToolbar } from './PreviewToolbar';

/*
 * Developer-only (route `/dev/rest-history`, never in production builds): the History section of
 * Insights > Rest (docs/design/41-caregiver-rest.md section 12) over an in-memory API with invented
 * nights. `?state=ok` (14 nights; the 28 toggle answers 28), `belowMinimum` (5 nights, 3 counted:
 * counts and sentences, no summary chart), `notEnoughLog` (no night has an estimate), `disabled`,
 * `error`. No sign-in, no server, no real person.
 */

const SCENARIOS = ['ok', 'belowMinimum', 'notEnoughLog', 'disabled', 'error'] as const;
type Scenario = (typeof SCENARIOS)[number];

function previewApi(scenario: Scenario) {
  return fakeApi((call) => {
    if (!call.path.includes('/me/rest/history')) return undefined;
    if (scenario === 'error') throw httpError(500);
    const fixture: HistoryScenario =
      scenario === 'ok' && call.path.endsWith('nights=28') ? 'long' : scenario;
    return restHistoryFixture(fixture);
  }).api;
}

function ScenarioScreen({ scenario }: { scenario: Scenario }) {
  const [api] = useState(() => previewApi(scenario));
  const [queries] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  );
  return (
    <ApiClientContext value={api}>
      <QueryClientProvider client={queries}>
        <RestHistorySection />
      </QueryClientProvider>
    </ApiClientContext>
  );
}

/** Developer-only: the rest history with synthetic answers. */
export default function RestHistoryPreview() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const requested = params.get('state');
  const scenario: Scenario = SCENARIOS.find((s) => s === requested) ?? 'ok';
  return (
    <Box sx={{ bgcolor: 'background.default', color: 'text.primary', minHeight: '100dvh' }}>
      <Box
        sx={{
          maxWidth: 720,
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
          {t('rest.title')}
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
