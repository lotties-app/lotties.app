import { act, render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CONSENT_REQUIRED_EVENT } from '../api/apiClient';
import { ApiClientContext } from '../api/ApiClientContext';
import { AuthContext } from '../auth/AuthContext';
import { I18nProvider } from '../i18n/I18nProvider';
import { CONSENT_VERSION } from '../legal/consentVersions';
import { clearAccountDeviceState } from '../session/deviceState';
import { fakeApi, networkError, type ApiCall } from '../test/fakeApi';
import { fakeAuth } from '../test/fakeAuth';
import { useConsent } from './ConsentContext';
import { ConsentProvider } from './ConsentProvider';
import { loadAcceptedConsent, loadPendingOptionalConsents } from './consentStorage';
import { CONSENTS_PATH, acceptedView, consentsView, rememberConsent } from './consentTestData';

/* ConsentProvider: what it tells the sync engine, how optional consents are recorded and retried, and per-account isolation. */

const holder: { current: ReturnType<typeof useConsent> | null } = { current: null };
const consent = {
  recordOptional: (...args: Parameters<ReturnType<typeof useConsent>['recordOptional']>) =>
    holder.current?.recordOptional(...args),
};

function Probe() {
  const latest = useConsent();
  useEffect(() => {
    holder.current = latest;
  });
  return (
    <p data-testid="state">
      {latest.status}/{String(latest.syncAllowed)}
    </p>
  );
}

function renderProvider(handler: (call: ApiCall) => unknown, auth = fakeAuth()) {
  const fake = fakeApi(handler);
  const view = render(
    <I18nProvider>
      <AuthContext value={auth}>
        <ApiClientContext value={fake.api}>
          <ConsentProvider>
            <Probe />
          </ConsentProvider>
        </ApiClientContext>
      </AuthContext>
    </I18nProvider>,
  );
  return { ...fake, ...view };
}

const state = () => screen.getByTestId('state').textContent;

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  clearAccountDeviceState();
});

describe('syncing', () => {
  it('is allowed once the server confirmed the consent, and not before', async () => {
    renderProvider((call) => (call.path === CONSENTS_PATH ? acceptedView() : undefined));

    expect(state()).toBe('checking/false');
    await waitFor(() => expect(state()).toBe('accepted/true'));
  });

  it('is not allowed while a consent is required', async () => {
    renderProvider((call) => (call.path === CONSENTS_PATH ? consentsView() : undefined));

    await waitFor(() => expect(state()).toBe('required/false'));
  });

  it('follows the device cache while the server cannot be asked', async () => {
    rememberConsent(CONSENT_VERSION);
    renderProvider(() => {
      throw networkError();
    });

    expect(state()).toBe('accepted/true');
  });

  it('is not allowed for an unverified account with no cache (the local data is readable only)', async () => {
    renderProvider(() => {
      throw networkError();
    });

    await waitFor(() => expect(state()).toBe('accepted/false'));
  });

  it('signed out there is nothing to ask and nothing blocked', () => {
    const { calls } = renderProvider(
      () => undefined,
      fakeAuth({ isAuthenticated: false, user: null }),
    );

    expect(state()).toBe('signed-out/true');
    expect(calls).toHaveLength(0);
  });
});

describe('a consent that changes under a running app', () => {
  it('asks the server again when a request is refused for want of a consent', async () => {
    let view = acceptedView();
    renderProvider((call) => (call.path === CONSENTS_PATH ? view : undefined));
    await waitFor(() => expect(state()).toBe('accepted/true'));

    view = consentsView();
    window.dispatchEvent(new Event(CONSENT_REQUIRED_EVENT));

    await waitFor(() => expect(state()).toBe('required/false'));
  });
});

describe('optional consents', () => {
  const optionalCalls = (calls: ApiCall[]) =>
    calls.filter((call) => call.path.startsWith(`${CONSENTS_PATH}/optional/`));

  it('records a switch with the kind, the answer and the language', async () => {
    const { calls } = renderProvider((call) =>
      call.path === CONSENTS_PATH ? acceptedView() : acceptedView(),
    );
    await waitFor(() => expect(state()).toBe('accepted/true'));

    act(() => consent.recordOptional('push', true));

    await waitFor(() => expect(optionalCalls(calls)).toHaveLength(1));
    expect(optionalCalls(calls)[0]).toMatchObject({
      method: 'PUT',
      path: `${CONSENTS_PATH}/optional/push`,
      body: { granted: true, locale: 'en' },
    });
    await waitFor(() => expect(loadPendingOptionalConsents()).toEqual({}));
  });

  it('never blocks: a failed call stays on the device and is retried when back online', async () => {
    let online = false;
    const { calls } = renderProvider((call) => {
      if (call.path.startsWith(`${CONSENTS_PATH}/optional/`)) {
        if (!online) throw networkError();
        return acceptedView();
      }
      return acceptedView();
    });
    await waitFor(() => expect(state()).toBe('accepted/true'));

    act(() => consent.recordOptional('alexa', true));
    await waitFor(() => expect(optionalCalls(calls)).toHaveLength(1));
    expect(loadPendingOptionalConsents()).toEqual({ alexa: true });

    online = true;
    window.dispatchEvent(new Event('online'));
    await waitFor(() => expect(loadPendingOptionalConsents()).toEqual({}));
    expect(optionalCalls(calls)).toHaveLength(2);
  });

  it('keeps only the newest answer per kind', async () => {
    const { calls } = renderProvider(() => {
      throw networkError();
    });
    await waitFor(() => expect(state()).toBe('accepted/false'));

    act(() => {
      consent.recordOptional('mcp', true);
      consent.recordOptional('mcp', false);
    });

    expect(loadPendingOptionalConsents()).toEqual({ mcp: false });
    void calls;
  });
});

describe('accounts', () => {
  it('never reads another account’s remembered acceptance', async () => {
    rememberConsent(CONSENT_VERSION);

    renderProvider(
      (call) => (call.path === CONSENTS_PATH ? consentsView() : undefined),
      fakeAuth({ accountId: 'https://issuer.test|someone-else' }),
    );

    await waitFor(() => expect(state()).toBe('required/false'));
    expect(loadAcceptedConsent()).toBeNull();
  });
});
