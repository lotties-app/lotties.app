import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Typography } from '@mui/material';
import { useSearchParams } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiClientContext } from '../api/ApiClientContext';
import { CommunityInsightsSection } from '../communityInsights/CommunityInsightsSection';
import type { CommunityConsentView } from '../communityInsights/communityConsentApi';
import type { Baby } from '../db/models';
import { fakeApi } from '../test/fakeApi';
import { PreviewToolbar } from './PreviewToolbar';

/*
 * Developer-only (route `/dev/community-insights`, never in production builds): Settings >
 * Community insights (docs/design/34-community-insights.md section 3, task T2) over an in-memory
 * API, synthetic baby "Lia". `?state=none` (never turned on; "Turn on…" opens the opt-in screen),
 * `on` (turned on by Ana), `off` (turned off), `renewal` (yes under an older text). No sign-in, no
 * server. Not in the showcase: the feature is off for everyone until activation (T9).
 */

const SCENARIOS = ['none', 'on', 'off', 'renewal'] as const;
type Scenario = (typeof SCENARIOS)[number];

const BABY: Baby = { id: 'dev-community', name: 'Lia', birthDate: '2026-08-01', role: 'Owner' };
const AT = '2026-11-03T10:00:00Z';

const change = (action: 'granted' | 'withdrawn', textVersion = 'ci-1') => ({
  action,
  at: AT,
  textVersion,
  policyVersion: '9',
  byName: 'Ana',
  byMe: false,
});

const view = (status: CommunityConsentView['status'], latest: CommunityConsentView['latest']) => ({
  status,
  currentTextVersion: 'ci-1',
  latest,
  history: latest ? [latest] : [],
});

const VIEWS: Record<Scenario, CommunityConsentView> = {
  none: view('none', null),
  on: view('on', change('granted')),
  off: view('off', change('withdrawn')),
  renewal: view('renewal_needed', change('granted', 'ci-0')),
};

function previewApi(scenario: Scenario) {
  let current = VIEWS[scenario];
  return fakeApi((call) => {
    if (!call.path.includes('/community-consent')) return undefined;
    if (call.method === 'PUT') {
      const granted = (call.body as { granted: boolean }).granted;
      current = granted
        ? view('on', { ...change('granted'), byMe: true })
        : view('off', { ...change('withdrawn'), byMe: true });
    }
    return current;
  }).api;
}

/** One scenario: its own in-memory API and query cache (remounted when the scenario changes). */
function ScenarioSection({ scenario }: { scenario: Scenario }) {
  const [api] = useState(() => previewApi(scenario));
  const [queries] = useState(() => new QueryClient());
  return (
    <ApiClientContext value={api}>
      <QueryClientProvider client={queries}>
        <CommunityInsightsSection baby={BABY} expanded />
      </QueryClientProvider>
    </ApiClientContext>
  );
}

/** Developer-only: the community insights consent section with synthetic answers. */
export default function CommunityInsightsPreview() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const requested = params.get('state');
  const scenario: Scenario = SCENARIOS.find((s) => s === requested) ?? 'none';
  return (
    <Box sx={{ bgcolor: 'background.default', color: 'text.primary', minHeight: '100dvh' }}>
      <Box sx={{ maxWidth: 480, mx: 'auto', px: 2, pt: 2, pb: 4, display: 'grid', gap: 2 }}>
        <Typography variant="h5" component="h1">
          {t('communityInsights.title')}
        </Typography>
        <ScenarioSection key={scenario} scenario={scenario} />
        <PreviewToolbar
          scenarios={SCENARIOS}
          scenario={scenario}
          onScenario={(next) => setParams({ state: next }, { replace: true })}
        />
      </Box>
    </Box>
  );
}
