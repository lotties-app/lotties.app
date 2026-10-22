import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import axe from 'axe-core';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { ApiClientContext } from '../../api/ApiClientContext';
import type { Baby } from '../../db/models';
import { I18nProvider } from '../../i18n/I18nProvider';
import { WhySheet } from '../../now/ui/WhySheet';
import { useTestLocale } from '../../test/locale';
import { testQueryClient } from '../../test/renderApp';
import { AppThemeProvider } from '../../theme/AppThemeProvider';
import { THEME_STORAGE_KEY } from '../../theme/themeStorage';
import {
  fakePushDevice,
  fakePushServer,
  type FakeDeviceOptions,
  type FakePushServerState,
} from '../fakePush';
import { PushDeviceContext } from '../PushDeviceContext';
import { readPromptDismissedAt } from '../reminderPrompt';
import { ReminderPromptCard } from './ReminderPromptCard';

const LIA: Baby = { id: 'baby-lia', name: 'Lia', birthDate: '2026-08-01', role: 'Owner' };
const PREFS = {
  babyId: LIA.id,
  canReceive: true,
  doseDue: false,
  doseLeadMinutes: 5 as const,
  napWindow: true,
  napLeadMinutes: 20 as const,
  bellyPainPattern: true,
  overtiredWarning: true,
  fussyPattern: false,
  diaperWetHeadsUp: true,
};

function wrap(
  children: React.ReactNode,
  deviceOptions: FakeDeviceOptions,
  server = fakePushServer(),
) {
  const device = fakePushDevice(deviceOptions);
  render(
    <I18nProvider>
      <AppThemeProvider>
        <QueryClientProvider client={testQueryClient()}>
          <ApiClientContext value={server.api}>
            <PushDeviceContext value={device}>
              <MemoryRouter>{children}</MemoryRouter>
            </PushDeviceContext>
          </ApiClientContext>
        </QueryClientProvider>
      </AppThemeProvider>
    </I18nProvider>,
  );
  return { device, server };
}

function setup(deviceOptions: FakeDeviceOptions = {}, state: Partial<FakePushServerState> = {}) {
  const onClose = vi.fn();
  const server = fakePushServer({ preferences: [PREFS], ...state });
  const result = wrap(<ReminderPromptCard baby={LIA} onClose={onClose} />, deviceOptions, server);
  return { ...result, onClose };
}

const card = () => screen.findByRole('region', { name: 'Get a reminder at the scheduled times?' });
const writes = (server: ReturnType<typeof fakePushServer>) =>
  server.calls.filter((c) => c.method !== 'GET').map((c) => `${c.method} ${c.path}`);

describe('ReminderPromptCard', () => {
  it('asks only through the explainer, then subscribes and turns on medicine reminders', async () => {
    const { device, server } = setup();
    fireEvent.click(within(await card()).getByRole('button', { name: 'Turn on' }));
    expect(device.prompts).toBe(0);
    const sheet = await screen.findByRole('dialog', { name: 'Turn on notifications?' });
    expect(within(sheet).getByRole('note').textContent).toMatch(/Not medical advice/);
    fireEvent.click(within(sheet).getByRole('button', { name: 'Turn on' }));
    expect(await screen.findByText('Medicine reminders are on for Lia.')).toBeTruthy();
    expect(device.prompts).toBe(1);
    expect(writes(server)).toEqual([
      'PUT /api/v1/push/settings',
      'POST /api/v1/push/subscriptions',
      `PUT /api/v1/babies/${LIA.id}/notification-preferences`,
    ]);
    // The other choices of this baby are kept.
    expect(server.calls.find((c) => c.path.endsWith('/notification-preferences'))?.body).toEqual({
      doseDue: true,
      doseLeadMinutes: 5,
      napWindow: true,
      napLeadMinutes: 20,
      bellyPainPattern: true,
      overtiredWarning: true,
      fussyPattern: false,
      diaperWetHeadsUp: true,
      diaperDirtyHeadsUp: false,
      appointmentReminders: true,
      doctorSuggestions: false,
    });
  });

  it('only turns the kind on when this device is already subscribed', async () => {
    const { device, server } = setup({ permission: 'granted', subscribed: true });
    fireEvent.click(within(await card()).getByRole('button', { name: 'Turn on' }));
    fireEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Turn on' }),
    );
    await screen.findByText('Medicine reminders are on for Lia.');
    expect(device.prompts).toBe(0);
    expect(writes(server)).toEqual([`PUT /api/v1/babies/${LIA.id}/notification-preferences`]);
  });

  it('subscribes nothing when the browser prompt is refused', async () => {
    const { server } = setup({ answer: 'denied' });
    fireEvent.click(within(await card()).getByRole('button', { name: 'Turn on' }));
    fireEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Turn on' }),
    );
    expect(await screen.findByText('Notifications were not allowed')).toBeTruthy();
    expect(writes(server)).toEqual([]);
  });

  it('Not now hides it on this device and closes', async () => {
    const { onClose, device } = setup();
    fireEvent.click(within(await card()).getByRole('button', { name: 'Not now' }));
    expect(onClose).toHaveBeenCalled();
    expect(readPromptDismissedAt()).not.toBeNull();
    expect(device.prompts).toBe(0);
  });

  it('is never shown when unsupported, blocked, already on, or recently dismissed', async () => {
    const cases: [FakeDeviceOptions, Partial<FakePushServerState>][] = [
      [{ support: 'unsupported' }, {}],
      [{ support: 'ios-needs-install' }, {}],
      [{ permission: 'denied' }, {}],
      [{ permission: 'granted', subscribed: true }, { preferences: [{ ...PREFS, doseDue: true }] }],
      [{}, { preferences: [{ ...PREFS, canReceive: false }] }],
    ];
    for (const [deviceOptions, state] of cases) {
      const { server } = setup(deviceOptions, state);
      await waitFor(() => expect(server.calls.length).toBeGreaterThan(0));
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(screen.queryByRole('region')).toBeNull();
      document.body.innerHTML = '';
    }
  });
});

const NAP_WINDOW = {
  earliest: '2026-10-21T14:20:00Z',
  expected: '2026-10-21T14:40:00Z',
  latest: '2026-10-21T15:00:00Z',
  confidence: 'Medium' as const,
  sampleCount: 12,
  basis: {},
};

describe('the nap Why sheet', () => {
  const window_ = NAP_WINDOW;

  it('links to the notification settings when push works here', async () => {
    wrap(<WhySheet open onClose={() => undefined} window={window_} />, {});
    const link = await screen.findByRole('link', { name: 'Remind me when the window opens' });
    expect(link.getAttribute('href')).toBe('/settings#notifications');
  });

  it('has no link where notifications cannot work', async () => {
    wrap(<WhySheet open onClose={() => undefined} window={window_} />, { support: 'unsupported' });
    await screen.findByRole('dialog');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByRole('link', { name: 'Remind me when the window opens' })).toBeNull();
  });
});

async function violations() {
  const result = await axe.run(document.body, {
    runOnly: ['wcag2a', 'wcag2aa'],
    rules: { 'color-contrast': { enabled: false } },
  });
  return result.violations.map(
    (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`,
  );
}

describe.each(['light', 'dark'] as const)('the prompt card in the %s scheme', (scheme) => {
  it.each(['en', 'pt-BR'] as const)(
    'has no accessibility violations in %s',
    async (locale) => {
      window.localStorage.setItem(THEME_STORAGE_KEY, scheme);
      if (locale === 'pt-BR') await useTestLocale('pt-BR');
      setup();
      const title =
        locale === 'en'
          ? 'Get a reminder at the scheduled times?'
          : 'Receber um lembrete nos horários agendados?';
      await screen.findByRole('region', { name: title });
      expect(await violations()).toEqual([]);
    },
    60_000,
  );

  it.each(['en', 'pt-BR'] as const)(
    'the Why sheet link has no accessibility violations in %s',
    async (locale) => {
      window.localStorage.setItem(THEME_STORAGE_KEY, scheme);
      if (locale === 'pt-BR') await useTestLocale('pt-BR');
      wrap(<WhySheet open onClose={() => undefined} window={NAP_WINDOW} />, {});
      await screen.findByRole('link', {
        name:
          locale === 'en' ? 'Remind me when the window opens' : 'Me lembrar quando a janela abrir',
      });
      expect(await violations()).toEqual([]);
    },
    60_000,
  );
});
