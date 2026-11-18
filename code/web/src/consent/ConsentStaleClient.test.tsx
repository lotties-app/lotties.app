import axe from 'axe-core';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BabyRoutineDb } from '../db/database';
import { CONSENT_VERSION, CONSENT_VERSIONS } from '../legal/consentVersions';
import { pretendNativeApp } from '../platform/nativeTestKit';
import { fakeApi, httpError, testDatabase, type ApiCall } from '../test/fakeApi';
import { useTestLocale } from '../test/locale';
import { renderWithDb, settleSync } from '../test/renderApp';
import { CONSENTS_PATH, acceptedView, consentsView } from './consentTestData';
import { GatedApp } from './consentTestKit';
import { reloadPage } from './reloadPage';

/*
 * A client older than the server (docs/design/38-consent-and-terms.md section 10): the server asks for a consent version this
 * build does not carry, so the screen asks for an update instead of offering Accept. jsdom has no service worker, so the web
 * attempt is the reload alone (the worker steps are covered by staleClient.test.ts).
 */
vi.mock('./reloadPage', () => ({ reloadPage: vi.fn() }));

/** A version later than anything this build knows: the server has moved on. */
const SERVER_AHEAD = '2099-12-31.1';

let db: BabyRoutineDb;
let undoNative: (() => void) | undefined;

beforeEach(() => {
  db = testDatabase();
  window.sessionStorage.clear();
  vi.mocked(reloadPage).mockClear();
});

afterEach(async () => {
  undoNative?.();
  undoNative = undefined;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await settleSync();
  await db.delete().catch(() => undefined);
});

function renderGate(handler: (call: ApiCall) => unknown) {
  const fake = fakeApi(handler);
  const view = renderWithDb(db, <GatedApp />, { api: fake.api });
  return { ...fake, ...view };
}

const serverAt =
  (currentVersion: string) =>
  (call: ApiCall): unknown =>
    call.path === CONSENTS_PATH && call.method === 'GET'
      ? consentsView({ currentVersion })
      : undefined;

async function fillAndAccept() {
  fireEvent.click(await screen.findByRole('radio', { name: /parent or legal guardian/ }));
  fireEvent.click(screen.getByRole('checkbox', { name: /I declare that I am/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Accept and continue' }));
}

describe('a stale native app', () => {
  it('asks for an update from the store instead of offering Accept, and can still decline', async () => {
    undoNative = pretendNativeApp('android');
    vi.stubEnv('VITE_PLAY_STORE_URL', 'https://play.google.com/store/apps/details?id=app.example');
    const { calls } = renderGate(serverAt(SERVER_AHEAD));

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Update Lotties to continue' }),
    ).toBeTruthy();
    expect(screen.getByText(/this version of Lotties cannot show the new text/)).toBeTruthy();
    expect(screen.getByText(/from Google Play, then open it again/)).toBeTruthy();
    expect(
      screen.getByRole('link', { name: /Open Lotties on Google Play/ }).getAttribute('href'),
    ).toBe('https://play.google.com/store/apps/details?id=app.example');
    expect(screen.queryByRole('button', { name: 'Accept and continue' })).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByText('the app')).toBeNull();
    expect(reloadPage).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Decline' }));
    expect(await screen.findByRole('dialog', { name: 'Decline and sign out?' })).toBeTruthy();
    expect(calls.some((call) => call.method === 'PUT')).toBe(false);
  });

  it('says where to update in text alone when there is no store address (iPhone)', async () => {
    undoNative = pretendNativeApp('ios');
    renderGate(serverAt(SERVER_AHEAD));

    expect(await screen.findByText(/from the App Store \(or from TestFlight/)).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Google Play/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Accept and continue' })).toBeNull();
  });
});

describe('a stale browser', () => {
  it('reloads once into the latest version, then shows the update panel on the reloaded page', async () => {
    const first = renderGate(serverAt(SERVER_AHEAD));

    expect(await screen.findByText('Getting the latest version of Lotties…')).toBeTruthy();
    await waitFor(() => expect(reloadPage).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('button', { name: 'Accept and continue' })).toBeNull();
    first.unmount();

    // The reloaded page is still on the old bundle: no second attempt in this session.
    renderGate(serverAt(SERVER_AHEAD));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Update Lotties to continue' }),
    ).toBeTruthy();
    expect(screen.getByText(/Close every Lotties tab, or the installed app/)).toBeTruthy();
    expect(screen.getByText(/clear this site's data/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Accept and continue' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Decline' })).toBeTruthy();
    expect(reloadPage).toHaveBeenCalledTimes(1);
  });

  it('never reloads when the session flag cannot be stored', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    renderGate(serverAt(SERVER_AHEAD));

    expect(await screen.findByRole('heading', { name: 'Update Lotties to continue' })).toBeTruthy();
    expect(reloadPage).not.toHaveBeenCalled();
  });

  it.each([
    ['en', 'Update Lotties to continue'],
    ['pt-BR', 'Atualize o Lotties para continuar'],
  ] as const)('has no accessibility violations (%s)', async (locale, title) => {
    if (locale !== 'en') await useTestLocale(locale);
    window.sessionStorage.setItem('lotties.consent.stale-reload', '1');
    const { container } = renderGate(serverAt(SERVER_AHEAD));

    await screen.findByRole('heading', { level: 1, name: title });
    const result = await axe.run(container, {
      runOnly: ['wcag2a', 'wcag2aa'],
      rules: { 'color-contrast': { enabled: false } },
    });
    expect(result.violations.map((v) => `${v.id}: ${v.nodes[0]?.html}`)).toEqual([]);
  });

  it('shows the panel in Brazilian Portuguese', async () => {
    await useTestLocale('pt-BR');
    window.sessionStorage.setItem('lotties.consent.stale-reload', '1');
    renderGate(serverAt(SERVER_AHEAD));

    expect(
      await screen.findByRole('heading', { name: 'Atualize o Lotties para continuar' }),
    ).toBeTruthy();
    expect(screen.getByText(/não consegue mostrar o novo texto/)).toBeTruthy();
    expect(screen.getByText(/Feche todas as abas do Lotties/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Aceitar e continuar' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Recusar' })).toBeTruthy();
  });
});

describe('a client that is not stale', () => {
  it('offers Accept when the server asks for the version this build carries', async () => {
    const { calls } = renderGate((call) => {
      if (call.path === CONSENTS_PATH && call.method === 'GET') return consentsView();
      if (call.method === 'PUT') return acceptedView();
      return undefined;
    });

    await fillAndAccept();
    await screen.findByText('the app');
    expect(calls.find((call) => call.method === 'PUT')?.body).toMatchObject({
      version: CONSENT_VERSION,
    });
    expect(reloadPage).not.toHaveBeenCalled();
  });

  it('keeps the usual screen when this build is newer than the server (web deployed first)', async () => {
    const older = CONSENT_VERSIONS[0].version;
    expect(older).not.toBe(CONSENT_VERSION);
    renderGate((call) => {
      if (call.path === CONSENTS_PATH && call.method === 'GET')
        return consentsView({ currentVersion: older });
      if (call.method === 'PUT') throw httpError(409, 'consent_version_outdated');
      return undefined;
    });

    await fillAndAccept();
    expect((await screen.findByRole('alert')).textContent).toContain(
      'The text changed while you were reading it',
    );
    expect(screen.queryByRole('heading', { name: 'Update Lotties to continue' })).toBeNull();
    expect(reloadPage).not.toHaveBeenCalled();
  });
});

describe('a 409 while she was reading', () => {
  it('asks the server again and shows the update panel, focused, when it moved ahead of this build', async () => {
    undoNative = pretendNativeApp('android');
    let server = CONSENT_VERSION;
    const { calls } = renderGate((call) => {
      if (call.path === CONSENTS_PATH && call.method === 'GET') {
        return consentsView({ currentVersion: server });
      }
      if (call.method === 'PUT') {
        server = SERVER_AHEAD; // a deploy landed while she read
        throw httpError(409, 'consent_version_outdated');
      }
      return undefined;
    });

    await fillAndAccept();
    const heading = await screen.findByRole('heading', {
      level: 1,
      name: 'Update Lotties to continue',
    });
    await waitFor(() => expect(document.activeElement).toBe(heading));
    expect(screen.queryByRole('button', { name: 'Accept and continue' })).toBeNull();
    expect(screen.queryByText(/The text changed while you were reading it/)).toBeNull();
    expect(calls.filter((call) => call.method === 'GET').length).toBeGreaterThanOrEqual(2);
  });

  it('keeps the reload message when the fresh answer shows the same version', async () => {
    renderGate((call) => {
      if (call.path === CONSENTS_PATH && call.method === 'GET') return consentsView();
      if (call.method === 'PUT') throw httpError(409, 'consent_version_outdated');
      return undefined;
    });

    await fillAndAccept();
    expect((await screen.findByRole('alert')).textContent).toContain(
      'The text changed while you were reading it',
    );
    expect(screen.getByRole('button', { name: 'Accept and continue' })).toBeTruthy();
    expect(reloadPage).not.toHaveBeenCalled();
  });
});
