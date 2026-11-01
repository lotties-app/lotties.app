import { render, screen, waitFor } from '@testing-library/react';
import Dexie from 'dexie';
import { User, UserManager } from 'oidc-client-ts';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import App from '../App';
import { createEvent } from '../db/eventCommands';
import { openAccountDatabase, accountDatabaseName } from '../session/accountDatabase';
import { seedBaby } from '../test/seed';
import { BABY_ID, TYPE_ID } from '../test/fakeApi';
import { accountIdOf } from './AuthContext';

// The service worker is not available in jsdom.
vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({
    needRefresh: [false, vi.fn()],
    offlineReady: [false, vi.fn()],
    updateServiceWorker: vi.fn(),
  }),
}));

const AUTHORITY = 'https://issuer.test/realms/baby';
const CLIENT_ID = 'web';
const API = 'http://api.test';
const ACCOUNT = accountIdOf(AUTHORITY, 'ana');
const CONFIG = {
  ok: true as const,
  config: { apiBaseUrl: API, oidc: { authority: AUTHORITY, clientId: CLIENT_ID } },
};

/** The whole app boots in these tests (OIDC, Dexie, sync): allow for a loaded test runner. */
const SLOW = { timeout: 15_000 };

const nowSeconds = () => Math.floor(Date.now() / 1000);

function oidcUser(accessToken: string, expiresAt: number) {
  return new User({
    access_token: accessToken,
    refresh_token: `refresh-of-${accessToken}`,
    token_type: 'Bearer',
    scope: 'openid profile offline_access',
    profile: { sub: 'ana', iss: AUTHORITY, aud: CLIENT_ID, exp: expiresAt, iat: expiresAt - 300 },
    expires_at: expiresAt,
  });
}

/** A session whose 5-minute access token expired a minute ago, refresh token still stored. */
function storeExpiredSession() {
  window.localStorage.setItem(
    `oidc.user:${AUTHORITY}:${CLIENT_ID}`,
    oidcUser('old', nowSeconds() - 60).toStorageString(),
  );
}

interface FetchCall {
  url: string;
  authorization: string | undefined;
}

function stubApi() {
  const calls: FetchCall[] = [];
  const json = (body: unknown) =>
    new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const headers = (init?.headers ?? {}) as Record<string, string>;
      calls.push({ url, authorization: headers.Authorization });
      if (url === `${API}/api/v1/babies`) {
        return json([{ id: BABY_ID, name: 'Lia', birthDate: '2026-08-01', role: 'Owner' }]);
      }
      if (url.includes('/predictions')) {
        return json({ babyId: BABY_ID, generatedAt: new Date().toISOString(), predictions: [] });
      }
      return json([]);
    }),
  );
  return calls;
}

let signinSilent: MockInstance<UserManager['signinSilent']>;

beforeEach(() => {
  window.history.pushState({}, '', '/');
  storeExpiredSession();
  signinSilent = vi.spyOn(UserManager.prototype, 'signinSilent');
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  for (const name of await Dexie.getDatabaseNames()) await Dexie.delete(name);
});

describe('cold start after the access token expired (B1)', () => {
  it('online: opens the app, renews in the background and calls the API with the new token', async () => {
    const calls = stubApi();
    signinSilent.mockImplementation(async function (this: UserManager) {
      const renewed = oidcUser('new', nowSeconds() + 300);
      await this.storeUser(renewed);
      await this.events.load(renewed);
      return renewed;
    });

    render(<App configResult={CONFIG} />);

    expect(await screen.findByRole('banner', {}, SLOW)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Sign in' })).toBeNull();
    await waitFor(
      () => expect(calls.some((c) => c.url === `${API}/api/v1/babies`)).toBe(true),
      SLOW,
    );
    expect(signinSilent).toHaveBeenCalledOnce();
    expect(calls.every((c) => c.authorization === 'Bearer new')).toBe(true);
    expect(window.location.pathname).toBe('/');
  });

  it('offline: opens from local data, never redirects to sign-in, never calls the network', async () => {
    const calls = stubApi();
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const db = openAccountDatabase(ACCOUNT);
    await seedBaby(db);
    db.close();

    render(<App configResult={CONFIG} />);

    expect(await screen.findByText('Lia', {}, SLOW)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Sign in' })).toBeNull();
    expect(window.location.pathname).toBe('/');
    expect(signinSilent).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });

  it('refresh token rejected: asks to sign in again and keeps the local data and its queue', async () => {
    stubApi();
    signinSilent.mockRejectedValue(
      Object.assign(new Error('Token is not active'), {
        name: 'ErrorResponse',
        error: 'invalid_grant',
      }),
    );
    const db = openAccountDatabase(ACCOUNT);
    await seedBaby(db);
    await createEvent(db, { babyId: BABY_ID, typeId: TYPE_ID });
    db.close();

    render(<App configResult={CONFIG} />);

    expect(await screen.findByText('Your session ended', {}, SLOW)).toBeTruthy();
    expect(
      await screen.findByText(
        '1 change is waiting to sync on this device. Sign in to sync it.',
        {},
        SLOW,
      ),
    ).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Sign in' }).length).toBeGreaterThan(0);
    expect(window.location.pathname).toBe('/');
    expect(window.localStorage.getItem(`oidc.user:${AUTHORITY}:${CLIENT_ID}`)).toBeNull();
    expect(await Dexie.exists(accountDatabaseName(ACCOUNT))).toBe(true);
    const kept = openAccountDatabase(ACCOUNT);
    expect(await kept.outbox.count()).toBe(1);
    expect(await kept.events.count()).toBe(1);
    kept.close();
  });
});
