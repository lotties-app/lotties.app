import { useState } from 'react';
import { Box } from '@mui/material';
import { useSearchParams } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiClientContext } from '../api/ApiClientContext';
import { RhythmSection } from '../rhythm/RhythmSection';
import { rhythmFixture, RHYTHM_SCENARIOS } from '../rhythm/rhythmFixtures';
import { fakeApi, httpError } from '../test/fakeApi';
import { PreviewToolbar } from './PreviewToolbar';

/*
 * Developer-only (route `/dev/rhythm`, never in production builds): the "Her rhythm" section of
 * Insights (docs/design/48-baby-rhythm.md) over an in-memory API with invented numbers for the
 * invented baby Lia. `?state=ok` (every metric and two comparisons), `partial` (some metrics still
 * need nights or days, too few nights to compare), `empty` (nothing logged), `varies` (bed time and
 * wake-up spread, no clear difference), `error`. No sign-in, no server, no real person.
 */

const SCENARIOS = [...RHYTHM_SCENARIOS, 'error'] as const;
type Scenario = (typeof SCENARIOS)[number];

const PREVIEW_BABY = { id: 'preview-baby', name: 'Lia' };

function previewApi(scenario: Scenario) {
  return fakeApi((call) => {
    if (!call.path.includes('/rhythm')) return undefined;
    if (scenario === 'error') throw httpError(500);
    return rhythmFixture(scenario);
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
        <RhythmSection babyId={PREVIEW_BABY.id} babyName={PREVIEW_BABY.name} />
      </QueryClientProvider>
    </ApiClientContext>
  );
}

/** Developer-only: the rhythm section with synthetic answers. */
export default function RhythmPreview() {
  const [params, setParams] = useSearchParams();
  const requested = params.get('state');
  const scenario: Scenario = SCENARIOS.find((s) => s === requested) ?? 'ok';
  return (
    <Box
      component="main"
      sx={{ bgcolor: 'background.default', color: 'text.primary', minHeight: '100dvh' }}
    >
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
