import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BabyRoutineDb } from '../db/database';
import { CONSENT_VERSION } from '../legal/consentVersions';
import { fakeApi, httpError, networkError, testDatabase, type ApiCall } from '../test/fakeApi';
import { fakeAuth } from '../test/fakeAuth';
import { useTestLocale } from '../test/locale';
import { renderWithDb, settleSync } from '../test/renderApp';
import { loadAcceptedConsent } from './consentStorage';
import { CONSENTS_PATH, acceptedView, consentsView, rememberConsent } from './consentTestData';
import { GatedApp } from './consentTestKit';

/* The consent gate between the auth guard and the app (docs/design/38-consent-and-terms.md section 3). */

let db: BabyRoutineDb;

beforeEach(() => {
  db = testDatabase();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await settleSync();
  await db.delete().catch(() => undefined);
});

function renderGate(handler: (call: ApiCall) => unknown, auth = fakeAuth()) {
  const fake = fakeApi(handler);
  renderWithDb(db, <GatedApp />, { api: fake.api, auth });
  return { ...fake, auth };
}

const answers =
  (view = consentsView()) =>
  (call: ApiCall) =>
    call.path === CONSENTS_PATH && call.method === 'GET' ? view : undefined;

async function fillAndAccept(capacity: RegExp = /parent or legal guardian/) {
  fireEvent.click(await screen.findByRole('radio', { name: capacity }));
  fireEvent.click(screen.getByRole('checkbox', { name: /I declare that I am/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Accept and continue' }));
}

describe('ConsentGate', () => {
  it('shows the consent screen instead of the app until the current version is accepted', async () => {
    renderGate(answers());

    expect(await screen.findByRole('heading', { level: 1, name: 'Before you start' })).toBeTruthy();
    expect(screen.queryByText('the app')).toBeNull();
    expect(screen.getByText(/health data about a child/)).toBeTruthy();
    expect(screen.getByText(/no system is fully secure: a leak is possible/)).toBeTruthy();
    expect(screen.getByText(/not a medical device/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Privacy Policy' }).getAttribute('href')).toBe(
      '/privacy',
    );
    expect(screen.getByRole('link', { name: 'Terms of Use' }).getAttribute('href')).toBe('/terms');
    expect(screen.getByText(/the Lotties project maintainers/)).toBeTruthy();
  });

  it('keeps Accept off until she says who she is and ticks the declaration', async () => {
    renderGate(answers());
    const accept = (await screen.findByRole('button', {
      name: 'Accept and continue',
    })) as HTMLButtonElement;

    expect(accept.disabled).toBe(true);
    fireEvent.click(screen.getByRole('radio', { name: /authorised by them/ }));
    expect(accept.disabled).toBe(true);
    fireEvent.click(screen.getByRole('checkbox', { name: /I declare that I am/ }));
    expect(accept.disabled).toBe(false);
  });

  it('records the acceptance with the version, the capacity and the language, then opens the app', async () => {
    const { calls } = renderGate((call) => {
      if (call.path === CONSENTS_PATH && call.method === 'GET') return consentsView();
      if (call.path === `${CONSENTS_PATH}/core`) return acceptedView();
      return undefined;
    });

    await fillAndAccept(/authorised by them/);

    expect(await screen.findByText('the app')).toBeTruthy();
    const put = calls.find((call) => call.method === 'PUT');
    expect(put?.path).toBe(`${CONSENTS_PATH}/core`);
    expect(put?.body).toEqual({ version: CONSENT_VERSION, capacity: 'authorised', locale: 'en' });
    expect(loadAcceptedConsent()).toEqual({ version: CONSENT_VERSION, capacity: 'guardian' });
  });

  it('opens the app straight away for an account that accepted the current version', async () => {
    renderGate(answers(acceptedView()));

    expect(await screen.findByText('the app')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Before you start' })).toBeNull();
    expect(loadAcceptedConsent()?.version).toBe(CONSENT_VERSION);
  });

  it('shows a spinner while the server is asked and nothing is cached', () => {
    renderGate(() => new Promise(() => undefined));

    expect(screen.getByLabelText('Loading')).toBeTruthy();
    expect(screen.queryByText('the app')).toBeNull();
  });

  it('tells a version that changed under her to reload, and a failed call to retry', async () => {
    let outcome: 'outdated' | 'down' = 'outdated';
    renderGate((call) => {
      if (call.path === CONSENTS_PATH && call.method === 'GET') return consentsView();
      if (call.method === 'PUT') {
        throw outcome === 'outdated' ? httpError(409, 'consent_version_outdated') : networkError();
      }
      return undefined;
    });

    await fillAndAccept();
    expect((await screen.findByRole('alert')).textContent).toContain(
      'The text changed while you were reading it',
    );
    outcome = 'down';
    fireEvent.click(screen.getByRole('button', { name: 'Accept and continue' }));
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('We could not save your answer'),
    );
    expect(screen.queryByText('the app')).toBeNull();
  });

  it('explains what declining does, then signs out; going back changes nothing', async () => {
    const { auth, calls } = renderGate(answers());

    fireEvent.click(await screen.findByRole('button', { name: 'Decline' }));
    const dialog = await screen.findByRole('dialog', { name: 'Decline and sign out?' });
    expect(within(dialog).getByText(/nothing about a child will be stored/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Go back' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(auth.logout).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Decline' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Decline and sign out' }));
    await waitFor(() => expect(auth.logout).toHaveBeenCalled());
    expect(calls.some((call) => call.method === 'PUT')).toBe(false);
  });

  it('offers to leave instead: download the data and delete the account, without accepting', async () => {
    renderGate(answers());

    fireEvent.click(await screen.findByRole('button', { name: /Leave Lotties instead/ }));

    expect(await screen.findByRole('button', { name: 'Delete my account…' })).toBeTruthy();
  });

  it('says so, and cannot accept, while offline', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    rememberConsent('1999-01-01.1');
    renderGate(() => {
      throw networkError();
    });

    expect(await screen.findByText('Before you start')).toBeTruthy();
    expect(screen.getByText(/You are offline/)).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: /parent or legal guardian/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /I declare that I am/ }));
    expect(
      (screen.getByRole('button', { name: 'Accept and continue' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('shows the screen in Brazilian Portuguese and records the language', async () => {
    await useTestLocale('pt-BR');
    const { calls } = renderGate((call) => {
      if (call.path === CONSENTS_PATH && call.method === 'GET') return consentsView();
      if (call.method === 'PUT') return acceptedView();
      return undefined;
    });

    expect(await screen.findByRole('heading', { name: 'Antes de começar' })).toBeTruthy();
    expect(screen.getByText(/pode haver vazamento/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Política de Privacidade' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Termos de Uso' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Recusar' })).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: /pai, mãe ou responsável legal/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Declaro que sou/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Aceitar e continuar' }));

    await screen.findByText('the app');
    expect(calls.find((call) => call.method === 'PUT')?.body).toMatchObject({ locale: 'pt-BR' });
  });
});

describe('ConsentGate offline', () => {
  it('opens the app offline with the version this device last saw confirmed', async () => {
    rememberConsent(CONSENT_VERSION);
    const { calls } = renderGate(() => {
      throw networkError();
    });

    expect(await screen.findByText('the app')).toBeTruthy();
    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    expect(screen.queryByRole('heading', { name: 'Before you start' })).toBeNull();
  });

  it('lets the server overrule the cache: a material change shows the screen', async () => {
    rememberConsent(CONSENT_VERSION);
    renderGate(answers(consentsView({ core: null, requiresAcceptance: true })));

    expect(await screen.findByRole('heading', { name: 'Before you start' })).toBeTruthy();
  });

  it('with nothing cached and no answer from the server, the local data stays readable', async () => {
    renderGate(() => {
      throw networkError();
    });

    expect(await screen.findByText('the app')).toBeTruthy();
  });

  it('asks again when the device comes back online', async () => {
    rememberConsent(CONSENT_VERSION);
    let online = false;
    renderGate((call) => {
      if (call.path !== CONSENTS_PATH) return undefined;
      if (!online) throw networkError();
      return consentsView();
    });
    await screen.findByText('the app');

    online = true;
    window.dispatchEvent(new Event('online'));

    expect(await screen.findByRole('heading', { name: 'Before you start' })).toBeTruthy();
  });
});
