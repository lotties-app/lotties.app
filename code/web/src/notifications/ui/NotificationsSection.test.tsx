import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import axe from 'axe-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClientContext } from '../../api/ApiClientContext';
import type { Baby } from '../../db/models';
import { I18nProvider } from '../../i18n/I18nProvider';
import { testQueryClient } from '../../test/renderApp';
import { useTestLocale } from '../../test/locale';
import { AppThemeProvider } from '../../theme/AppThemeProvider';
import { nightPeriodKey } from '../../theme/nightFeed';
import { NIGHT_FEED_STATE_STORAGE_KEY } from '../../theme/nightFeedStorage';
import { THEME_STORAGE_KEY } from '../../theme/themeStorage';
import {
  FAKE_ENDPOINT,
  fakePushDevice,
  fakePushServer,
  type FakeDeviceOptions,
  type FakePushServerState,
} from '../fakePush';
import { PushDeviceContext } from '../PushDeviceContext';
import { NotificationsSection } from './NotificationsSection';

const LIA: Baby = { id: 'baby-lia', name: 'Lia', birthDate: '2026-08-01', role: 'Owner' };
const THEO: Baby = { id: 'baby-theo', name: 'Theo', birthDate: '2025-02-10', role: 'Viewer' };

const PREFS = [
  {
    babyId: LIA.id,
    canReceive: true,
    doseDue: false,
    doseLeadMinutes: 0 as const,
    napWindow: false,
    napLeadMinutes: 10 as const,
  },
  {
    babyId: THEO.id,
    canReceive: false,
    doseDue: false,
    doseLeadMinutes: 0 as const,
    napWindow: false,
    napLeadMinutes: 10 as const,
  },
];

afterEach(() => {
  vi.restoreAllMocks();
});

function setup(
  deviceOptions: FakeDeviceOptions = {},
  serverState: Partial<FakePushServerState> = {},
  online?: boolean,
) {
  const device = fakePushDevice(deviceOptions);
  const server = fakePushServer({ preferences: PREFS, ...serverState });
  render(
    <I18nProvider>
      <AppThemeProvider>
        <QueryClientProvider client={testQueryClient()}>
          <ApiClientContext value={server.api}>
            <PushDeviceContext value={device}>
              <NotificationsSection
                babies={[LIA, THEO]}
                publicKey="BFakeKey"
                {...(online === undefined ? {} : { online })}
              />
            </PushDeviceContext>
          </ApiClientContext>
        </QueryClientProvider>
      </AppThemeProvider>
    </I18nProvider>,
  );
  return { device, server };
}

const deviceSwitch = () => screen.findByRole('switch', { name: /Notifications on this device/ });
const writes = (server: ReturnType<typeof fakePushServer>) =>
  server.calls.filter((c) => c.method !== 'GET');

describe('NotificationsSection device switch', () => {
  it('never asks for permission on load; the switch opens our explainer first', async () => {
    const { device, server } = setup();
    const toggle = await deviceSwitch();
    await screen.findByText('Lia');
    expect(device.prompts).toBe(0);
    expect(toggle.getAttribute('aria-checked')).toBe('false');

    fireEvent.click(toggle);
    const sheet = await screen.findByRole('dialog', { name: 'Turn on notifications?' });
    expect(within(sheet).getByRole('note').textContent).toMatch(/Not medical advice/);
    expect(device.prompts).toBe(0);

    fireEvent.click(within(sheet).getByRole('button', { name: 'Turn on' }));
    await waitFor(() => expect(device.prompts).toBe(1));
    await waitFor(() =>
      expect(writes(server).map((c) => `${c.method} ${c.path}`)).toEqual([
        'PUT /api/v1/push/settings',
        'POST /api/v1/push/subscriptions',
      ]),
    );
    expect(await screen.findByText('Notifications are on for this device')).toBeTruthy();
    await waitFor(async () =>
      expect((await deviceSwitch()).getAttribute('aria-checked')).toBe('true'),
    );
  });

  it('"Not now" closes the explainer without prompting', async () => {
    const { device } = setup();
    fireEvent.click(await deviceSwitch());
    const sheet = await screen.findByRole('dialog', { name: 'Turn on notifications?' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Not now' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(device.prompts).toBe(0);
  });

  it('announces a refused prompt and subscribes nothing', async () => {
    const { server } = setup({ answer: 'denied' });
    fireEvent.click(await deviceSwitch());
    fireEvent.click(await screen.findByRole('button', { name: 'Turn on' }));
    expect(await screen.findByText('Notifications were not allowed')).toBeTruthy();
    expect(await screen.findByText(/Notifications are blocked for this site/)).toBeTruthy();
    expect(writes(server)).toEqual([]);
  });

  it('re-subscribes without a prompt when permission is already granted', async () => {
    const { device, server } = setup({ permission: 'granted' });
    fireEvent.click(await deviceSwitch());
    await waitFor(() =>
      expect(writes(server).some((c) => c.path === '/api/v1/push/subscriptions')).toBe(true),
    );
    expect(device.prompts).toBe(0);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('turns off: revokes on the server, then unsubscribes; test send targets this device', async () => {
    const { device, server } = setup({ permission: 'granted', subscribed: true });
    await waitFor(async () =>
      expect((await deviceSwitch()).getAttribute('aria-checked')).toBe('true'),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Send a test notification' }));
    await waitFor(() =>
      expect(writes(server).at(-1)).toMatchObject({
        path: '/api/v1/push/test',
        body: { endpoint: FAKE_ENDPOINT },
      }),
    );

    fireEvent.click(await deviceSwitch());
    await waitFor(() => expect(device.state.subscription).toBeNull());
    expect(writes(server).at(-1)).toMatchObject({
      path: '/api/v1/push/subscriptions/revoke',
      body: { endpoint: FAKE_ENDPOINT },
    });
    expect(await screen.findByText('Notifications are off for this device')).toBeTruthy();
  });

  it('shows how to allow notifications when blocked, with the switch disabled', async () => {
    setup({ permission: 'denied' });
    expect((await deviceSwitch()).hasAttribute('disabled')).toBe(true);
    expect(await screen.findByText(/Notifications are blocked for this site/)).toBeTruthy();
  });

  it('guides iPhone Safari tabs to the Home Screen app instead of a switch', async () => {
    setup({ support: 'ios-needs-install' });
    expect(await screen.findByText(/add Lotties to your Home Screen/)).toBeTruthy();
    expect(screen.queryByRole('switch', { name: /Notifications on this device/ })).toBeNull();
  });

  it('says when iOS is too old or the browser cannot show notifications', async () => {
    setup({ support: 'ios-too-old' });
    expect(await screen.findByText('Needs iOS 16.4 or later.')).toBeTruthy();
  });
});

describe('NotificationsSection reminders and settings', () => {
  it('saves the full preference state per baby and shows lead times once on', async () => {
    const { server } = setup();
    const lia = await screen.findByRole('region', { name: 'Lia' });
    fireEvent.click(within(lia).getByRole('switch', { name: /Medicine reminders/ }));
    await waitFor(() =>
      expect(writes(server).at(-1)).toEqual({
        method: 'PUT',
        path: `/api/v1/babies/${LIA.id}/notification-preferences`,
        body: { doseDue: true, doseLeadMinutes: 0, napWindow: false, napLeadMinutes: 10 },
      }),
    );
    fireEvent.click(await within(lia).findByRole('radio', { name: '15 min before' }));
    await waitFor(() =>
      expect(writes(server).at(-1)?.body).toEqual({
        doseDue: true,
        doseLeadMinutes: 15,
        napWindow: false,
        napLeadMinutes: 10,
      }),
    );
  });

  it('disables Viewer rows with the reason', async () => {
    setup();
    const theo = await screen.findByRole('region', { name: 'Theo' });
    expect(within(theo).getByText('Only parents get reminders for this baby.')).toBeTruthy();
    for (const toggle of within(theo).getAllByRole('switch')) {
      expect(toggle.hasAttribute('disabled')).toBe(true);
    }
  });

  it('saves quiet hours and show names with the device time zone', async () => {
    const { server } = setup({ timeZone: 'Europe/Lisbon' });
    fireEvent.click(await screen.findByRole('switch', { name: /Show baby and medicine names/ }));
    await waitFor(() =>
      expect(writes(server).at(-1)).toMatchObject({
        method: 'PUT',
        path: '/api/v1/push/settings',
        body: { timeZone: 'Europe/Lisbon', showNames: true },
      }),
    );
    const start = screen.getByLabelText('From');
    fireEvent.change(start, { target: { value: '21:30' } });
    fireEvent.blur(start);
    await waitFor(() =>
      expect(writes(server).at(-1)?.body).toMatchObject({
        quietHours: { enabled: true, start: '21:30', end: '07:00' },
      }),
    );
    expect(screen.getByText('Times use Europe/Lisbon.')).toBeTruthy();
  });

  it('refuses equal start and end times locally', async () => {
    const { server } = setup();
    const start = await screen.findByLabelText('From');
    fireEvent.change(start, { target: { value: '07:00' } });
    fireEvent.blur(start);
    expect(await screen.findByText('Start and end must be different times.')).toBeTruthy();
    expect(writes(server)).toEqual([]);
  });

  it('lists devices and removes another one', async () => {
    const { server } = setup(
      {},
      {
        devices: [
          {
            id: 'other',
            deviceLabel: 'Safari on iOS',
            locale: 'en',
            createdAt: '2026-10-01T10:00:00.000Z',
            lastSeenAt: '2026-10-20T10:00:00.000Z',
            lastSuccessAt: null,
          },
        ],
      },
    );
    const list = await screen.findByRole('list', { name: 'Your devices' });
    fireEvent.click(within(list).getByRole('button', { name: 'Remove Safari on iOS' }));
    await waitFor(() =>
      expect(writes(server).at(-1)).toMatchObject({
        method: 'DELETE',
        path: '/api/v1/push/subscriptions/other',
      }),
    );
    expect(await screen.findByText('No devices get notifications yet.')).toBeTruthy();
  });

  it('is read-only offline, with the reason', async () => {
    setup({ permission: 'granted', subscribed: true }, {}, false);
    expect(
      await screen.findByText('Connect to the internet to change notification settings.'),
    ).toBeTruthy();
    expect((await deviceSwitch()).hasAttribute('disabled')).toBe(true);
  });

  it('renders in Portuguese', async () => {
    await useTestLocale('pt-BR');
    setup();
    expect(
      await screen.findByRole('switch', { name: /Notificações neste dispositivo/ }),
    ).toBeTruthy();
    expect(await screen.findByText('Só os pais recebem lembretes deste bebê.')).toBeTruthy();
  });
});

function chooseScheme(scheme: 'light' | 'dark' | 'night') {
  if (scheme === 'night') {
    window.localStorage.setItem(
      NIGHT_FEED_STATE_STORAGE_KEY,
      JSON.stringify({ override: { on: true, key: nightPeriodKey(new Date()) } }),
    );
  } else {
    window.localStorage.setItem(THEME_STORAGE_KEY, scheme);
  }
}

async function violations() {
  const result = await axe.run(document.body, {
    runOnly: ['wcag2a', 'wcag2aa'],
    rules: { 'color-contrast': { enabled: false } },
  });
  return result.violations.map(
    (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`,
  );
}

describe.each(['light', 'dark', 'night'] as const)('in the %s scheme', (scheme) => {
  describe.each(['en', 'pt-BR'] as const)('and %s', (locale) => {
    it('the section and the explainer have no accessibility violations', async () => {
      chooseScheme(scheme);
      if (locale === 'pt-BR') await useTestLocale('pt-BR');
      setup({}, { preferences: PREFS.map((p) => ({ ...p, doseDue: p.canReceive })) });
      await screen.findByRole('region', { name: 'Lia' });
      await screen.findAllByRole('radio');
      expect(await violations()).toEqual([]);

      fireEvent.click(
        await screen.findByRole('switch', {
          name: locale === 'en' ? /Notifications on this device/ : /Notificações neste dispositivo/,
        }),
      );
      await screen.findByRole('dialog');
      expect(await violations()).toEqual([]);
    }, 60_000);
  });
});
