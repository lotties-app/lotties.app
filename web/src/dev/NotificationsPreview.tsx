import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Box, Typography } from '@mui/material';
import { useSearchParams } from 'react-router-dom';
import { ApiClientContext } from '../api/ApiClientContext';
import type { Baby } from '../db/models';
import { fakePushDevice, fakePushServer, type FakeDeviceOptions } from '../notifications/fakePush';
import { PushDeviceContext } from '../notifications/PushDeviceContext';
import { pushKeys } from '../notifications/usePush';
import { NotificationsSection } from '../notifications/ui/NotificationsSection';
import { PushExplainerSheet } from '../notifications/ui/PushExplainerSheet';
import { SettingsSection } from '../settings/SettingsSection';
import { PreviewToolbar } from './PreviewToolbar';

/*
 * Developer-only (route `/dev/notifications`, never in production builds): Settings >
 * Notifications over a fake browser and an in-memory server, one state at a time
 * (`?state=on`, `&scheme=dark`). No sign-in, no service worker, no real push.
 */

const SCENARIOS = [
  'off',
  'explainer',
  'on',
  'granted-off',
  'denied',
  'unsupported',
  'ios-needs-install',
  'ios-too-old',
  'offline',
] as const;
type Scenario = (typeof SCENARIOS)[number];

const BABIES: Baby[] = [
  { id: 'dev-push-lia', name: 'Lia', birthDate: '2026-08-01', role: 'Owner' },
  { id: 'dev-push-theo', name: 'Theo', birthDate: '2025-02-10', role: 'Viewer' },
];

const DEVICE: Record<Scenario, FakeDeviceOptions> = {
  off: {},
  explainer: {},
  on: { permission: 'granted', subscribed: true },
  'granted-off': { permission: 'granted' },
  denied: { permission: 'denied' },
  unsupported: { support: 'unsupported' },
  'ios-needs-install': { support: 'ios-needs-install' },
  'ios-too-old': { support: 'ios-too-old' },
  offline: { permission: 'granted', subscribed: true },
};

const DAY = 24 * 60 * 60_000;

function setup(scenario: Scenario) {
  const device = fakePushDevice(DEVICE[scenario]);
  const on = DEVICE[scenario].subscribed === true;
  const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();
  const server = fakePushServer({
    settings: {
      timeZone: 'America/Sao_Paulo',
      quietHours: { enabled: true, start: '22:00', end: '07:00' },
      quietIncludesMedicine: false,
      showNames: false,
    },
    preferences: [
      {
        babyId: 'dev-push-lia',
        canReceive: true,
        doseDue: on,
        doseLeadMinutes: 5,
        napWindow: on,
        napLeadMinutes: 10,
      },
      {
        babyId: 'dev-push-theo',
        canReceive: false,
        doseDue: false,
        doseLeadMinutes: 0,
        napWindow: false,
        napLeadMinutes: 10,
      },
    ],
    devices: [
      ...(on
        ? [
            {
              id: 'this-device',
              deviceLabel: 'Chrome on Android',
              locale: 'en',
              createdAt: ago(12),
              lastSeenAt: ago(0),
              lastSuccessAt: ago(1),
            },
          ]
        : []),
      {
        id: 'other-device',
        deviceLabel: 'Safari on iOS',
        locale: 'pt-BR',
        createdAt: ago(40),
        lastSeenAt: ago(2),
        lastSuccessAt: ago(2),
      },
    ],
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (scenario === 'offline') {
    // Offline shows the last loaded values: seed the cache as if loaded before.
    queryClient.setQueryData(pushKeys.settings, server.state.settings);
    queryClient.setQueryData(pushKeys.preferences, server.state.preferences);
    queryClient.setQueryData(pushKeys.devices, server.state.devices);
  }
  return { device, server, queryClient };
}

function Body({ scenario }: { scenario: Scenario }) {
  const { t } = useTranslation();
  const [{ device, server, queryClient }] = useState(() => setup(scenario));
  const [explainer, setExplainer] = useState(scenario === 'explainer');
  return (
    <QueryClientProvider client={queryClient}>
      <ApiClientContext value={server.api}>
        <PushDeviceContext value={device}>
          <SettingsSection
            id="notifications"
            title={t('settings.sections.notifications')}
            defaultExpanded
          >
            <NotificationsSection
              babies={BABIES}
              publicKey="BFakeKey"
              {...(scenario === 'offline' ? { online: false } : {})}
            />
          </SettingsSection>
          <PushExplainerSheet
            open={explainer}
            onClose={() => setExplainer(false)}
            onTurnOn={() => setExplainer(false)}
          />
        </PushDeviceContext>
      </ApiClientContext>
    </QueryClientProvider>
  );
}

/** Developer-only: Settings > Notifications in every device state (`/dev/notifications?state=on`). */
export default function NotificationsPreview() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const requested = params.get('state');
  const scenario: Scenario = SCENARIOS.find((s) => s === requested) ?? 'off';
  return (
    <Box sx={{ bgcolor: 'background.default', color: 'text.primary', minHeight: '100dvh' }}>
      <Box sx={{ maxWidth: 480, mx: 'auto', px: 2, pt: 1, pb: 12 }}>
        <Typography variant="h5" component="h1" sx={{ py: 1 }}>
          {t('settings.title')}
        </Typography>
        <Body key={scenario} scenario={scenario} />
        <PreviewToolbar
          scenarios={SCENARIOS}
          scenario={scenario}
          onScenario={(next) => setParams({ state: next }, { replace: true })}
        />
      </Box>
    </Box>
  );
}
