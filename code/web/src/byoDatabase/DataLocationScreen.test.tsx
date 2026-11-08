import axe from 'axe-core';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ApiError } from '../api/ApiError';
import type { BabyRoutineDb } from '../db/database';
import type { Baby } from '../db/models';
import { fakeApi, httpError, testDatabase, type ApiCall } from '../test/fakeApi';
import { renderWithDb, settleSync } from '../test/renderApp';
import type { DataStoreStatus, DataStoreTestResult, DataStoreView } from './dataStoreApi';
import { DataLocationScreen } from './DataLocationScreen';
import { DataLocationSection } from './DataLocationSection';

/* Settings > Where your data lives (bring your own database, docs/design/47 section 8). */

let db: BabyRoutineDb;

beforeEach(() => {
  db = testDatabase();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

afterEach(async () => {
  await settleSync();
  await db.delete();
});

const OWNER: Baby = { id: 'baby-1', name: 'Lia', birthDate: '2026-08-01', role: 'Owner' };
const PATH = '/api/v1/babies/baby-1/data-store';
const APP_PASSWORD = 'app-Secret-7c1e';
const MIGRATOR_PASSWORD = 'mig-Secret-90ab';

const store = (overrides: Partial<DataStoreStatus> = {}): DataStoreStatus => ({
  state: 'pending',
  providerLabel: 'Supabase',
  hasDescriptor: true,
  schemaVersion: null,
  lastCheckedAt: null,
  lastCheckResult: null,
  updatedAt: '2026-11-07T10:00:00Z',
  ...overrides,
});

interface Server {
  view?: DataStoreView;
  test?: DataStoreTestResult | ApiError;
  save?: ApiError;
  moveOut?: ApiError;
  get?: ApiError;
}

function render(server: Server = {}, baby: Baby = OWNER) {
  let view = server.view ?? { kind: 'hosted', store: null };
  const fake = fakeApi((call: ApiCall) => {
    if (call.path === PATH && call.method === 'GET') {
      if (server.get) throw server.get;
      return view;
    }
    if (call.path === PATH && call.method === 'PUT') {
      if (server.save) throw server.save;
      view = { kind: view.kind, store: store() };
      return view;
    }
    if (call.path === `${PATH}/test`) {
      if (server.test instanceof ApiError) throw server.test;
      return (
        server.test ?? { ok: true, result: 'ok', findings: [], checkedAt: '2026-11-07T10:00:00Z' }
      );
    }
    if (call.path === `${PATH}/move-out` || call.path === `${PATH}/move-in`) {
      throw server.moveOut ?? httpError(501, 'not_implemented');
    }
    if (call.path.startsWith('/api/v1/me/consents/optional/')) {
      return { optional: {} };
    }
    return undefined;
  });
  const result = renderWithDb(db, <DataLocationScreen baby={baby} />, { api: fake.api });
  return { ...fake, ...result };
}

const click = (name: RegExp | string) => fireEvent.click(screen.getByRole('button', { name }));
const type = (label: RegExp, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

/** Walks the wizard to its last step, typing every field (nothing must be sent meanwhile). */
async function walkToTest() {
  click('Set up my own database');
  expect(await screen.findByRole('heading', { name: 'Choose a provider' })).toBeTruthy();
  click('Next');
  expect(screen.getByRole('heading', { name: 'Prepare your database' })).toBeTruthy();
  expect(screen.getByLabelText('Setup SQL').textContent).toContain('CREATE SCHEMA lotties');
  click('Next');
  type(/^Host/, 'aws-0-sa-east-1.pooler.supabase.com');
  type(/^Password/, APP_PASSWORD);
  type(/^Migration host/, 'db.abcdefgh.supabase.co');
  type(/^Migration password/, MIGRATOR_PASSWORD);
  click('Next');
  expect(screen.getByRole('heading', { name: 'Your agreement' })).toBeTruthy();
  expect(screen.getByText(/your account at Supabase: availability, backups/)).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Next' })).toHaveProperty('disabled', true);
  fireEvent.click(screen.getByRole('checkbox'));
  click('Next');
  expect(screen.getByRole('heading', { name: 'Save and test', level: 3 })).toBeTruthy();
}

async function everythingStored(): Promise<string> {
  const tables = await Promise.all(db.tables.map((table) => table.toArray()));
  const storage = [window.localStorage, window.sessionStorage].flatMap((area) =>
    Object.keys(area).map((key) => `${key}=${area.getItem(key)}`),
  );
  return JSON.stringify({ tables, storage, url: window.location.href });
}

describe('the choice', () => {
  it('says the app stays the same, shows Lotties hosting as current and the honest limits', async () => {
    render();
    expect(
      await screen.findByText(/keep using the Lotties app and your account exactly as before/),
    ).toBeTruthy();
    const hosted = (await screen.findByRole('heading', { name: 'Lotties hosts it' })).closest(
      'div',
    )!;
    expect(within(hosted.parentElement!).getByText('Current')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'My own database' })).toBeTruthy();
    expect(screen.getByText('This is not end-to-end encryption.')).toBeTruthy();
    expect(screen.getByText(/Free plans may have no backups/)).toBeTruthy();
    expect(screen.getByText(/only you, the Owner/)).toBeTruthy();
    expect(screen.getByText(/You are responsible for your database and your account/)).toBeTruthy();
    expect(screen.getByText(/Lotties stays responsible for what it does itself/)).toBeTruthy();
    expect(
      screen.getByText(/Lotties' servers read your data whenever you use the app/),
    ).toBeTruthy();
  });

  it('never promises what Lotties does not do', async () => {
    const { container } = render();
    await screen.findByRole('heading', { name: 'Lotties hosts it' });
    click('Set up my own database');
    const text = container.textContent ?? '';
    for (const phrase of [
      /we cannot read your data/i,
      /only you can read/i,
      /zero-knowledge/i,
      /end-to-end encrypted/i,
      /never touches our servers/i,
      /we do not store your data/i,
      /safe from us/i,
    ]) {
      expect(text).not.toMatch(phrase);
    }
  });

  it('has no accessibility violations (choice and wizard)', async () => {
    const { container } = render({
      view: { kind: 'hosted', store: store({ lastCheckResult: 'ok' }) },
    });
    await screen.findByRole('heading', { name: 'Lotties hosts it' });
    const run = () =>
      axe.run(container, {
        runOnly: ['wcag2a', 'wcag2aa'],
        rules: { 'color-contrast': { enabled: false } },
      });
    expect((await run()).violations.map((v) => v.id)).toEqual([]);
    click('Replace the connection details');
    click('Next');
    click('Next');
    expect((await run()).violations.map((v) => v.id)).toEqual([]);
  });
});

describe('the setup wizard', () => {
  it('sends nothing before Save and test, then consent, save and test in that order', async () => {
    const { calls } = render();
    await screen.findByRole('heading', { name: 'Lotties hosts it' });
    await walkToTest();

    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([`GET ${PATH}`]);

    click('Save and test');
    expect(await screen.findByText('Connected')).toBeTruthy();
    const sent = calls.slice(1).map((c) => `${c.method} ${c.path}`);
    expect(sent.slice(0, 3)).toEqual([
      'PUT /api/v1/me/consents/optional/byo_database',
      `PUT ${PATH}`,
      `POST ${PATH}/test`,
    ]);
    expect(calls[1].body).toMatchObject({ granted: true });
    expect(calls[2].body).toMatchObject({
      providerLabel: 'Supabase',
      app: { host: 'aws-0-sa-east-1.pooler.supabase.com', port: 6543, password: APP_PASSWORD },
      migrator: { host: 'db.abcdefgh.supabase.co', port: 5432, password: MIGRATOR_PASSWORD },
      tls: { sslMode: 'verify_full' },
    });
  });

  it('keeps the passwords nowhere: not in storage, Dexie or the URL, and forgets them after the save', async () => {
    render({
      test: {
        ok: false,
        result: 'store_credentials_rejected',
        findings: [],
        checkedAt: '2026-11-07T10:00:00Z',
      },
    });
    await screen.findByRole('heading', { name: 'Lotties hosts it' });
    await walkToTest();
    const before = await everythingStored();
    expect(before).not.toContain(APP_PASSWORD);
    expect(before).not.toContain(MIGRATOR_PASSWORD);

    click('Save and test');
    expect(await screen.findByText('User name or password rejected')).toBeTruthy();
    const after = await everythingStored();
    expect(after).not.toContain(APP_PASSWORD);
    expect(after).not.toContain(MIGRATOR_PASSWORD);

    click('Change the details');
    expect((screen.getByLabelText(/^Password/) as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText(/^Migration password/) as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText(/^Host/) as HTMLInputElement).value).toBe(
      'aws-0-sa-east-1.pooler.supabase.com',
    );
    expect(document.body.textContent).not.toContain(APP_PASSWORD);
  });

  it('shows a coded result in plain words, never the server text', async () => {
    render({
      test: {
        ok: false,
        result: 'store_role_too_powerful',
        findings: ['superuser_like', 'unknown_thing'],
        checkedAt: '2026-11-07T10:00:00Z',
      },
    });
    await screen.findByRole('heading', { name: 'Lotties hosts it' });
    await walkToTest();
    click('Save and test');
    expect(await screen.findByText('The role can do too much')).toBeTruthy();
    expect(screen.getByText('The role has administrator rights.')).toBeTruthy();
    expect(document.body.textContent).not.toContain('store_role_too_powerful');
    expect(document.body.textContent).not.toContain('unknown_thing');
  });

  it.each([
    ['store_paused_or_unreachable', 'Database not reachable'],
    ['store_timeout', 'No answer in time'],
    ['store_rate_limited', 'Too many connections'],
    ['store_migrating', 'Setting up'],
    ['store_unavailable', 'Database not reachable'],
  ])('a store down for now (503 %s) says "%s" and when to try again', async (code, title) => {
    render({ test: new ApiError(503, { code, title: 'Service Unavailable' }, undefined, 30_000) });
    await screen.findByRole('heading', { name: 'Lotties hosts it' });
    await walkToTest();
    click('Save and test');
    expect(await screen.findByText(title)).toBeTruthy();
    expect(screen.getByText('You can test again in about 30 seconds.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Test again' })).toBeTruthy();
    expect(document.body.textContent).not.toContain('Service Unavailable');
  });

  it.each([
    ['store_tls_failed', 'Secure connection failed'],
    ['store_quota_full', 'Database full'],
    ['store_migration_failed', 'Setup did not finish'],
    ['endpoint_unresolvable', 'Address not found'],
  ])('an expected setup outcome (200 %s) says "%s"', async (code, title) => {
    render({ test: { ok: false, result: code, findings: [], checkedAt: '2026-11-07T10:00:00Z' } });
    await screen.findByRole('heading', { name: 'Lotties hosts it' });
    await walkToTest();
    click('Save and test');
    expect(await screen.findByText(title)).toBeTruthy();
  });

  it('keeps the details when the save is refused (blocked address), so they can be fixed', async () => {
    render({ save: httpError(422, 'endpoint_blocked_address') });
    await screen.findByRole('heading', { name: 'Lotties hosts it' });
    await walkToTest();
    click('Save and test');
    expect(await screen.findByText('Address not allowed')).toBeTruthy();
    click('Back');
    click('Back');
    expect((screen.getByLabelText(/^Password/) as HTMLInputElement).value).toBe(APP_PASSWORD);
  });
});

describe('a baby on her own database', () => {
  it.each([
    ['ready', null, 'Your database is working'],
    ['unreachable', 'store_paused_or_unreachable', 'Your database is not reachable'],
    ['unreachable', 'store_credentials_rejected', 'The database refused the password'],
    ['unreachable', 'store_quota_full', 'Your database is full'],
    ['schema_ahead', null, 'Your database is newer than the app'],
    ['role_too_powerful', null, 'The role can do too much'],
    ['migrating', null, 'Getting your database ready'],
  ])('state %s (%s) shows "%s"', async (state, lastCheckResult, title) => {
    render({ view: { kind: 'own', store: store({ state, lastCheckResult }) } });
    expect(await screen.findByText(title)).toBeTruthy();
    expect(screen.getByText('Your database: Supabase')).toBeTruthy();
  });

  it('links a problem to the guide, and a working database to nothing but the guide entry', async () => {
    const help = '/help/own-database#own-database-troubleshooting';
    const first = render({
      view: {
        kind: 'own',
        store: store({ state: 'unreachable', lastCheckResult: 'store_paused_or_unreachable' }),
      },
    });
    const banner = (await screen.findByText('Your database is not reachable')).closest(
      '[role="status"]',
    ) as HTMLElement;
    expect(
      within(banner)
        .getByRole('link', { name: 'What this means and what to do' })
        .getAttribute('href'),
    ).toBe(help);
    first.unmount();

    render({ view: { kind: 'own', store: store({ state: 'ready' }) } });
    expect(await screen.findByText('Your database is working')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'What this means and what to do' })).toBeNull();
    expect(
      screen.getByRole('link', { name: /How it works, step by step/ }).getAttribute('href'),
    ).toBe('/help/own-database');
  });

  it('explains a refused move in plain words and links the guide', async () => {
    render({
      view: { kind: 'own', store: store({ state: 'ready' }) },
      moveOut: httpError(409, 'store_move_in_progress'),
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Move back to Lotties hosting' }));
    expect(await screen.findByText(/already being moved/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'What this means and what to do' })).toBeTruthy();
  });

  it('"Move back to Lotties hosting" says it is not available yet on 501, without pretending', async () => {
    const { calls } = render({ view: { kind: 'own', store: store({ state: 'ready' }) } });
    fireEvent.click(await screen.findByRole('button', { name: 'Move back to Lotties hosting' }));
    expect(await screen.findByText(/not available yet/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Move back to Lotties hosting' })).toBeNull();
    expect(calls.some((c) => c.method === 'POST' && c.path === `${PATH}/move-out`)).toBe(true);
  });

  it('offers "Move my records there" only after a passing test, and says when it is not available', async () => {
    render({ view: { kind: 'hosted', store: store({ lastCheckResult: 'ok' }) } });
    fireEvent.click(await screen.findByRole('button', { name: 'Move my records there' }));
    expect(await screen.findByText(/not available yet/)).toBeTruthy();
  });
});

describe('update connection details', () => {
  const OWN_TROUBLED: DataStoreView = {
    kind: 'own',
    store: store({ state: 'unreachable', lastCheckResult: 'store_credentials_rejected' }),
  };

  async function openForm() {
    fireEvent.click(await screen.findByRole('button', { name: 'Update connection details' }));
  }

  function typeNewDetails() {
    type(/^Host/, 'aws-1-sa-east-1.pooler.supabase.com');
    type(/^Password/, APP_PASSWORD);
    type(/^Migration host/, 'db.abcdefgh.supabase.co');
    type(/^Migration password/, MIGRATOR_PASSWORD);
  }

  const valueOf = (label: RegExp) => (screen.getByLabelText(label) as HTMLInputElement).value;

  it('is offered on her own database, not while Lotties hosts a working one', async () => {
    const first = render({ view: { kind: 'own', store: store({ state: 'ready' }) } });
    expect(await screen.findByRole('button', { name: 'Update connection details' })).toBeTruthy();
    first.unmount();

    const second = render({ view: { kind: 'hosted', store: store({ lastCheckResult: 'ok' }) } });
    await screen.findByRole('heading', { name: 'Lotties hosts it' });
    expect(screen.queryByRole('button', { name: 'Update connection details' })).toBeNull();
    second.unmount();

    render({ view: { kind: 'hosted', store: null } });
    await screen.findByRole('heading', { name: 'Lotties hosts it' });
    expect(screen.queryByRole('button', { name: 'Update connection details' })).toBeNull();
  });

  it('is offered for a saved database in an error state', async () => {
    render({
      view: {
        kind: 'hosted',
        store: store({ state: 'pending', lastCheckResult: 'store_credentials_rejected' }),
      },
    });
    expect(await screen.findByRole('button', { name: 'Update connection details' })).toBeTruthy();
  });

  it('prefills no password and no host, and sends nothing until the fields are valid', async () => {
    const { calls } = render({ view: OWN_TROUBLED });
    await openForm();
    expect(valueOf(/^Password/)).toBe('');
    expect(valueOf(/^Migration password/)).toBe('');
    expect(valueOf(/^Host/)).toBe('');
    expect((screen.getByLabelText(/^Password/) as HTMLInputElement).type).toBe('password');
    click('Save new details and test');
    expect(screen.getAllByText('Required').length).toBeGreaterThan(0);
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([`GET ${PATH}`]);
  });

  it('replaces the details, tests them, confirms, and forgets the passwords', async () => {
    const { calls } = render({ view: OWN_TROUBLED });
    await openForm();
    typeNewDetails();
    click('Save new details and test');

    expect(await screen.findByText('Connected again')).toBeTruthy();
    const sent = calls.slice(1).map((c) => `${c.method} ${c.path}`);
    expect(sent.slice(0, 2)).toEqual([`PUT ${PATH}`, `POST ${PATH}/test`]);
    expect(sent.some((c) => c.includes('/consents/'))).toBe(false);
    expect(calls[1].body).toMatchObject({
      providerLabel: 'Supabase',
      app: { host: 'aws-1-sa-east-1.pooler.supabase.com', port: 6543, password: APP_PASSWORD },
      migrator: { host: 'db.abcdefgh.supabase.co', port: 5432, password: MIGRATOR_PASSWORD },
      tls: { sslMode: 'verify_full' },
    });
    expect(valueOf(/^Password/)).toBe('');
    expect(valueOf(/^Migration password/)).toBe('');
    const stored = await everythingStored();
    expect(stored).not.toContain(APP_PASSWORD);
    expect(stored).not.toContain(MIGRATOR_PASSWORD);
  });

  it('says in plain words when the database refuses the new details', async () => {
    render({
      view: OWN_TROUBLED,
      test: {
        ok: false,
        result: 'store_credentials_rejected',
        findings: [],
        checkedAt: '2026-11-07T10:00:00Z',
      },
    });
    await openForm();
    typeNewDetails();
    click('Save new details and test');
    expect(await screen.findByText('User name or password rejected')).toBeTruthy();
    expect(screen.queryByText('Connected again')).toBeNull();
    expect(document.body.textContent).not.toContain('store_credentials_rejected');
  });

  it('keeps the typed details when the save is refused, so they can be fixed', async () => {
    render({ view: OWN_TROUBLED, save: httpError(422, 'endpoint_blocked_address') });
    await openForm();
    typeNewDetails();
    click('Save new details and test');
    expect(await screen.findByText('Address not allowed')).toBeTruthy();
    expect(valueOf(/^Password/)).toBe(APP_PASSWORD);
  });

  it('says in plain words when the new details open another database, and runs no test', async () => {
    const { calls } = render({
      view: OWN_TROUBLED,
      save: httpError(409, 'store_not_same_database'),
    });
    await openForm();
    typeNewDetails();
    click('Save new details and test');
    expect(await screen.findByText('Not the same database')).toBeTruthy();
    expect(screen.getByText(/move the records back to Lotties hosting first/)).toBeTruthy();
    expect(document.body.textContent).not.toContain('store_not_same_database');
    expect(calls.some((c) => c.path === `${PATH}/test`)).toBe(false);
    expect(valueOf(/^Password/)).toBe(APP_PASSWORD);
  });

  it('tests the saved details on their own with the test route', async () => {
    const { calls } = render({
      view: OWN_TROUBLED,
      test: new ApiError(503, { code: 'store_paused_or_unreachable' }, undefined, 30_000),
    });
    await openForm();
    click('Test the saved details');
    expect(await screen.findByText('Database not reachable')).toBeTruthy();
    expect(calls.map((c) => `${c.method} ${c.path}`)).toContain(`POST ${PATH}/test`);
    expect(calls.some((c) => c.method === 'PUT')).toBe(false);
  });

  it('says moving back needs a readable database while the store is in trouble', async () => {
    const first = render({ view: OWN_TROUBLED });
    expect(
      await screen.findByText(/Update the connection details until the test passes/),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Move back to Lotties hosting' })).toBeTruthy();
    first.unmount();

    render({ view: { kind: 'own', store: store({ state: 'ready' }) } });
    await screen.findByText('Your database is working');
    expect(screen.queryByText(/Update the connection details until the test passes/)).toBeNull();
  });

  it('has no accessibility violations with the form open', async () => {
    const { container } = render({ view: OWN_TROUBLED });
    await openForm();
    const results = await axe.run(container, {
      runOnly: ['wcag2a', 'wcag2aa'],
      rules: { 'color-contrast': { enabled: false } },
    });
    expect(results.violations.map((v) => v.id)).toEqual([]);
  });
});

describe('Settings entry', () => {
  function renderSection(handler: (call: ApiCall) => unknown, baby: Baby = OWNER) {
    const fake = fakeApi(handler);
    renderWithDb(db, <DataLocationSection baby={baby} expanded />, { api: fake.api });
    return fake.calls;
  }

  it('shows nothing at all when the server hides the feature (404)', async () => {
    const calls = renderSection((call) => {
      if (call.path === PATH) throw httpError(404);
    });
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(screen.queryByText('Where your data lives')).toBeNull();
    expect(document.body.textContent).toBe('');
  });

  it('shows nothing and asks nothing for a baby the person does not own', async () => {
    const calls = renderSection(() => ({ kind: 'hosted', store: null }), {
      ...OWNER,
      role: 'Parent',
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(calls).toHaveLength(0);
    expect(document.body.textContent).toBe('');
  });

  it('shows the entry to the Owner when the server offers it', async () => {
    renderSection((call) => (call.path === PATH ? { kind: 'hosted', store: null } : undefined));
    expect(await screen.findByText('Where your data lives')).toBeTruthy();
    expect(screen.getByText("Lotties hosts your baby's records.")).toBeTruthy();
    expect(
      screen.getByRole('link', { name: 'Choose where your data lives' }).getAttribute('href'),
    ).toBe('/settings/data-location');
  });
});
