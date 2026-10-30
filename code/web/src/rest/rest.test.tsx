import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BabyRoutineDb } from '../db/database';
import { formatTime } from '../i18n/format';
import { InsightsPage } from '../pages/InsightsPage';
import { fakeApi, testDatabase, type ApiCall } from '../test/fakeApi';
import { useTestLocale } from '../test/locale';
import { renderWithDb, settleSync } from '../test/renderApp';
import { seedBaby } from '../test/seed';
import { DEFAULT_REST_SETTINGS, type RestEstimate, type RestSettings } from './restApi';
import { shiftNight, upAtFromTime, validateRestSettings } from './restModel';

let db: BabyRoutineDb;

beforeEach(() => {
  db = testDatabase();
});

afterEach(async () => {
  await settleSync();
  await db.delete();
  vi.restoreAllMocks();
});

const at = (hour: number, minute: number) => new Date(2026, 9, 30, hour, minute).toISOString();

const ON: RestSettings = {
  ...DEFAULT_REST_SETTINGS,
  enabled: true,
  timeZone: 'America/Sao_Paulo',
  workWindows: [{ days: [1, 2, 3, 4, 5], start: '08:00', end: '17:00' }],
};

function estimate(overrides: Partial<RestEstimate> = {}): RestEstimate {
  return {
    night: '2026-10-29',
    status: 'ok',
    parts: [
      {
        start: at(21, 20),
        end: at(23, 50),
        startSource: 'babyLog',
        endSource: 'ownEvent',
        confidence: 'normal',
      },
      {
        start: at(23, 59),
        end: null,
        startSource: 'babyLog',
        endSource: 'ongoing',
        confidence: 'low',
      },
    ],
    askMorning: false,
    constants: { fallAsleepMinutes: 20, wakeLeadMinutes: 20 },
    ...overrides,
  };
}

interface Server {
  settings: RestSettings;
  estimate: RestEstimate;
}

function restApi(server: Server) {
  return fakeApi((call: ApiCall) => {
    if (call.path.includes('/measurements')) return [];
    if (call.path === '/api/v1/me/rest-settings') {
      if (call.method === 'PUT') {
        server.settings = call.body as RestSettings;
        return undefined;
      }
      if (call.method === 'DELETE') {
        server.settings = DEFAULT_REST_SETTINGS;
        return undefined;
      }
      return server.settings;
    }
    if (call.path.startsWith('/api/v1/me/rest/morning')) return undefined;
    if (call.path.startsWith('/api/v1/me/rest')) return server.estimate;
    return undefined;
  });
}

async function renderInsights(server: Server) {
  await seedBaby(db);
  const fake = restApi(server);
  renderWithDb(db, <InsightsPage />, { api: fake.api });
  return fake;
}

const openRest = async () => fireEvent.click(await screen.findByRole('tab', { name: 'Rest' }));

describe('Rest tab visibility and opt-in', () => {
  it('shows only the opt-in card, no tab, while the feature is off', async () => {
    await renderInsights({ settings: DEFAULT_REST_SETTINGS, estimate: estimate() });
    const toggle = await screen.findByRole('switch', { name: /Show an estimate of my rest/ });
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(screen.getByText(/shown only to you\. It is not a measurement/)).toBeTruthy();
    expect(screen.queryByRole('tab', { name: 'Rest' })).toBeNull();
    expect(
      await screen.findByRole('heading', { name: 'Growth', level: 2 }, { timeout: 5000 }),
    ).toBeTruthy();
  });

  it('turning it on saves the defaults with the browser zone and shows the tab', async () => {
    const server = { settings: DEFAULT_REST_SETTINGS, estimate: estimate() };
    const { calls } = await renderInsights(server);
    fireEvent.click(await screen.findByRole('switch', { name: /Show an estimate of my rest/ }));
    expect(await screen.findByRole('tab', { name: 'Rest' })).toBeTruthy();
    const put = calls.find((c) => c.method === 'PUT');
    expect(put?.path).toBe('/api/v1/me/rest-settings');
    expect(put?.body).toEqual({
      ...DEFAULT_REST_SETTINGS,
      enabled: true,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
    expect(screen.queryByRole('switch', { name: /Show an estimate/ })).toBeNull();
  });

  it('shows the tab when on, with Insights first and Growth kept', async () => {
    await renderInsights({ settings: ON, estimate: estimate() });
    expect(await screen.findByRole('tab', { name: 'Insights', selected: true })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Rest' })).toBeTruthy();
    expect(await screen.findByRole('heading', { name: 'Growth', level: 2 })).toBeTruthy();
  });

  it('shows nothing about rest when the server does not know the route', async () => {
    await seedBaby(db);
    renderWithDb(db, <InsightsPage />, { api: fakeApi().api });
    expect(await screen.findByRole('heading', { name: 'Growth', level: 2 })).toBeTruthy();
    expect(screen.queryByRole('switch')).toBeNull();
    expect(screen.queryByRole('tab')).toBeNull();
  });
});

describe('Rest tab estimate', () => {
  it('lists the parts as approximate times with the disclaimer (en)', async () => {
    await renderInsights({ settings: ON, estimate: estimate() });
    await openRest();
    const list = await screen.findByRole('list', { name: 'Estimated rest' });
    const items = within(list).getAllByRole('listitem');
    expect(items[0].textContent).toBe(
      `about ${formatTime(at(21, 20))} to ${formatTime(at(23, 50))}`,
    );
    expect(items[1].textContent).toBe(
      `about ${formatTime(at(23, 59))}, still going (low confidence)`,
    );
    expect(screen.getByText("Estimated from the baby's log, not a measurement.")).toBeTruthy();
  });

  it('speaks Portuguese', async () => {
    await useTestLocale('pt-BR');
    await renderInsights({ settings: ON, estimate: estimate() });
    fireEvent.click(await screen.findByRole('tab', { name: 'Descanso' }));
    const list = await screen.findByRole('list', { name: 'Descanso estimado' });
    expect(within(list).getAllByRole('listitem')[0].textContent).toBe(
      `por volta das ${formatTime(at(21, 20))} às ${formatTime(at(23, 50))}`,
    );
    expect(screen.getByText(/não é uma medição/)).toBeTruthy();
  });

  it('says there is not enough in the log', async () => {
    await renderInsights({
      settings: ON,
      estimate: estimate({ status: 'notEnoughLog', parts: [] }),
    });
    await openRest();
    expect(await screen.findByText(/Not enough in the log/)).toBeTruthy();
  });

  it('goes to the previous night and back', async () => {
    const { calls } = await renderInsights({ settings: ON, estimate: estimate() });
    await openRest();
    await screen.findByRole('list', { name: 'Estimated rest' });
    expect((screen.getByRole('button', { name: 'Next night' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Previous night' }));
    await waitFor(() =>
      expect(calls.some((c) => c.path === '/api/v1/me/rest?night=2026-10-28')).toBe(true),
    );
  });

  it('shows an error with a way to retry', async () => {
    await seedBaby(db);
    const base = restApi({ settings: ON, estimate: estimate() });
    const failing = fakeApi((call) => {
      if (call.path === '/api/v1/me/rest') throw new Error('boom');
      return base.api.request(call.path, { method: call.method, body: call.body });
    });
    renderWithDb(db, <InsightsPage />, { api: failing.api });
    await openRest();
    expect(await screen.findByText('The estimate could not be loaded.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reload' })).toBeTruthy();
  });

  it('keeps the last answer when the connection drops and says so', async () => {
    await renderInsights({ settings: ON, estimate: estimate() });
    await openRest();
    await screen.findByRole('list', { name: 'Estimated rest' });
    const spy = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    try {
      window.dispatchEvent(new Event('offline'));
      expect(await screen.findByText(/Shown from your last connection/)).toBeTruthy();
      expect(screen.getByRole('list', { name: 'Estimated rest' })).toBeTruthy();
    } finally {
      spy.mockRestore();
      window.dispatchEvent(new Event('online'));
    }
  });
});

describe('Morning question', () => {
  const ask = () => estimate({ askMorning: true });

  it('is not shown when askMorning is false', async () => {
    await renderInsights({ settings: ON, estimate: estimate() });
    await openRest();
    await screen.findByRole('list', { name: 'Estimated rest' });
    expect(screen.queryByText('Are you up for the day?')).toBeNull();
  });

  it('"up now" sends the current time for that night', async () => {
    const { calls } = await renderInsights({ settings: ON, estimate: ask() });
    await openRest();
    fireEvent.click(await screen.findByRole('button', { name: "Yes, I'm up now" }));
    await waitFor(() => expect(calls.some((c) => c.path === '/api/v1/me/rest/morning')).toBe(true));
    const put = calls.find((c) => c.path === '/api/v1/me/rest/morning');
    expect(put?.method).toBe('PUT');
    const body = put?.body as { night: string; upAt: string };
    expect(body.night).toBe('2026-10-29');
    expect(Math.abs(Date.now() - Date.parse(body.upAt))).toBeLessThan(10_000);
  });

  it('"since a time" sends that time, not in the future', async () => {
    const { calls } = await renderInsights({ settings: ON, estimate: ask() });
    await openRest();
    fireEvent.click(await screen.findByRole('button', { name: 'Yes, since a time' }));
    fireEvent.change(screen.getByLabelText('Time you got up'), { target: { value: '06:40' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls.some((c) => c.path === '/api/v1/me/rest/morning')).toBe(true));
    const body = calls.find((c) => c.path === '/api/v1/me/rest/morning')?.body as {
      upAt: string;
    };
    const up = new Date(body.upAt);
    expect([up.getHours(), up.getMinutes()]).toEqual([6, 40]);
    expect(up.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it('"not yet" calls nothing, hides the question, and it returns when the tab reopens', async () => {
    const { calls } = await renderInsights({ settings: ON, estimate: ask() });
    await openRest();
    fireEvent.click(await screen.findByRole('button', { name: 'Not yet' }));
    expect(screen.queryByText('Are you up for the day?')).toBeNull();
    expect(calls.some((c) => c.path.includes('/morning'))).toBe(false);
    fireEvent.click(screen.getByRole('tab', { name: 'Insights' }));
    await openRest();
    expect(await screen.findByText('Are you up for the day?')).toBeTruthy();
  });
});

describe('Settings editor', () => {
  it('saves the full state exactly per the contract', async () => {
    const server = { settings: ON, estimate: estimate() };
    const { calls } = await renderInsights(server);
    await openRest();
    await screen.findByRole('heading', { name: 'Your rest settings' });
    fireEvent.click(screen.getByRole('button', { name: 'Add work window' }));
    expect(screen.getByRole('group', { name: 'Work window 2' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
    expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({
      enabled: true,
      timeZone: 'America/Sao_Paulo',
      workWindows: [
        { days: [1, 2, 3, 4, 5], start: '08:00', end: '17:00' },
        { days: [1, 2, 3, 4, 5], start: '08:00', end: '17:00' },
      ],
      nightStart: '19:00',
      nightEnd: '07:00',
      fallAsleepMinutes: 20,
      wakeLeadMinutes: 20,
    });
  });

  it('blocks an invalid state without calling the server', async () => {
    const { calls } = await renderInsights({ settings: ON, estimate: estimate() });
    await openRest();
    await screen.findByRole('heading', { name: 'Your rest settings' });
    fireEvent.change(screen.getByRole('textbox', { name: 'Time zone' }), {
      target: { value: 'Mars/Base' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(await screen.findByText(/Enter a valid time zone/)).toBeTruthy();
    expect(calls.some((c) => c.method === 'PUT')).toBe(false);
  });

  it('removes a work window', async () => {
    await renderInsights({ settings: ON, estimate: estimate() });
    await openRest();
    fireEvent.click(await screen.findByRole('button', { name: 'Remove window 1' }));
    expect(screen.queryByRole('group', { name: 'Work window 1' })).toBeNull();
  });

  it('asks before deleting, then deletes and returns to the opt-in', async () => {
    const { calls } = await renderInsights({ settings: ON, estimate: estimate() });
    await openRest();
    fireEvent.click(
      await screen.findByRole('button', { name: 'Turn off and delete my rest settings' }),
    );
    const dialog = await screen.findByRole('dialog');
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Turn off and delete my rest settings' }));
    fireEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', {
        name: 'Turn off and delete',
      }),
    );
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE')).toBe(true));
    expect(calls.find((c) => c.method === 'DELETE')?.path).toBe('/api/v1/me/rest-settings');
    expect(await screen.findByRole('switch', { name: /Show an estimate of my rest/ })).toBeTruthy();
    expect(screen.queryByRole('tab', { name: 'Rest' })).toBeNull();
  });
});

describe('Nothing is stored on the device', () => {
  it('writes nothing to localStorage, sessionStorage or Dexie while using the tab', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    await seedBaby(db);
    const outboxBefore = await db.outbox.count();
    const server = { settings: ON, estimate: estimate({ askMorning: true }) };
    const { calls } = await renderInsights(server);
    await openRest();
    fireEvent.click(await screen.findByRole('button', { name: "Yes, I'm up now" }));
    await waitFor(() => expect(calls.some((c) => c.path.includes('/morning'))).toBe(true));
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'PUT' && c.path.endsWith('rest-settings'))).toBe(true),
    );
    const restWrites = setItem.mock.calls.filter(([key, value]) =>
      /rest|morning|night|workWindows/i.test(`${key} ${value}`),
    );
    expect(restWrites).toEqual([]);
    expect(await db.outbox.count()).toBe(outboxBefore);
    for (const table of db.tables) {
      const rows = JSON.stringify(await table.toArray());
      expect(rows).not.toMatch(/workWindows|fallAsleepMinutes|upAt/);
    }
  });
});

describe('restModel', () => {
  it('validates like the server', () => {
    expect(validateRestSettings(ON)).toEqual([]);
    expect(
      validateRestSettings({
        ...ON,
        workWindows: [{ days: [], start: '08:00', end: '08:00' }],
        nightEnd: ON.nightStart,
        fallAsleepMinutes: 4,
        wakeLeadMinutes: 61,
      }),
    ).toEqual(['windowDays', 'windowSame', 'nightSame', 'fallAsleep', 'wakeLead']);
    const many = Array.from({ length: 15 }, () => ON.workWindows[0]);
    expect(validateRestSettings({ ...ON, workWindows: many })).toContain('tooManyWindows');
  });

  it('shifts nights and picks a time that is not in the future', () => {
    expect(shiftNight('2026-10-31', 1)).toBe('2026-11-01');
    expect(shiftNight('2026-03-01', -1)).toBe('2026-02-28');
    const now = new Date(2026, 9, 30, 6, 0);
    expect(new Date(upAtFromTime('06:40', now)!).getDate()).toBe(29);
    expect(new Date(upAtFromTime('05:10', now)!).getDate()).toBe(30);
    expect(upAtFromTime('', now)).toBeNull();
  });
});
