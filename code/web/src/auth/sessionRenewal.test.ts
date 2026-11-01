import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isDefinitiveRenewalFailure,
  SessionEndedError,
  TokenRenewalPendingError,
} from './renewalErrors';
import { SessionRenewal, type RenewableUser, type RenewalUserManager } from './sessionRenewal';

const stale: RenewableUser = { access_token: 'old', refresh_token: 'refresh', expired: true };
const fresh: RenewableUser = { access_token: 'new', refresh_token: 'refresh-2', expired: false };

/** OAuth error answer of the token endpoint, as `oidc-client-ts` throws it. */
function oauthError(error: string) {
  return Object.assign(new Error(error), { name: 'ErrorResponse', error });
}

function mockUserManager(stored: RenewableUser | null = stale) {
  let user = stored;
  const manager = {
    getUser: vi.fn(async () => user),
    signinSilent: vi.fn(async () => {
      user = fresh;
      return fresh;
    }),
  } satisfies RenewalUserManager;
  return manager;
}

let online = true;
let renewals: SessionRenewal[] = [];

function setup(manager: RenewalUserManager, onEnded = vi.fn()) {
  const target = new EventTarget();
  const renewal = new SessionRenewal({
    userManager: manager,
    isOnline: () => online,
    eventTarget: target,
    backoff: { baseMs: 1_000, maxMs: 60_000, random: () => 0.5 },
    onEnded,
  });
  renewal.start();
  renewals.push(renewal);
  return { renewal, target, onEnded };
}

beforeEach(() => {
  online = true;
  renewals = [];
});

afterEach(() => {
  renewals.forEach((r) => r.stop());
  vi.useRealTimers();
});

describe('SessionRenewal', () => {
  it('returns a valid stored token without renewing', async () => {
    const manager = mockUserManager({ access_token: 'ok', refresh_token: 'r', expired: false });
    const { renewal } = setup(manager);
    await expect(renewal.getAccessToken()).resolves.toBe('ok');
    expect(manager.signinSilent).not.toHaveBeenCalled();
    expect(renewal.getSnapshot()).toBe('idle');
  });

  it('returns null while signed out', async () => {
    const { renewal } = setup(mockUserManager(null));
    await expect(renewal.getAccessToken()).resolves.toBeNull();
  });

  it('expired token, online: renews with the refresh token and proceeds with the new one', async () => {
    const manager = mockUserManager();
    const { renewal } = setup(manager);
    const seen: string[] = [];
    renewal.subscribe(() => seen.push(renewal.getSnapshot()));

    await expect(renewal.getAccessToken()).resolves.toBe('new');

    expect(manager.signinSilent).toHaveBeenCalledOnce();
    expect(seen).toEqual(['renewing', 'idle']);
  });

  it('expired token, offline: never calls the identity provider and waits (no sign-out)', async () => {
    online = false;
    const manager = mockUserManager();
    const { renewal, onEnded } = setup(manager);

    await expect(renewal.getAccessToken()).rejects.toBeInstanceOf(TokenRenewalPendingError);

    expect(manager.signinSilent).not.toHaveBeenCalled();
    expect(renewal.getSnapshot()).toBe('waiting');
    expect(onEnded).not.toHaveBeenCalled();
  });

  it('retries when the device comes back online', async () => {
    online = false;
    const manager = mockUserManager();
    const { renewal, target } = setup(manager);
    await renewal.getAccessToken().catch(() => {});

    online = true;
    target.dispatchEvent(new Event('online'));

    await vi.waitFor(() => expect(renewal.getSnapshot()).toBe('idle'));
    expect(manager.signinSilent).toHaveBeenCalledOnce();
    await expect(renewal.getAccessToken()).resolves.toBe('new');
  });

  it('a network error keeps the session and retries with backoff', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const manager = mockUserManager();
    manager.signinSilent.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const { renewal, onEnded } = setup(manager);

    await expect(renewal.getAccessToken()).rejects.toBeInstanceOf(TokenRenewalPendingError);
    expect(renewal.getSnapshot()).toBe('waiting');
    // Before the backoff elapsed, callers fail fast without hitting the identity provider.
    await expect(renewal.getAccessToken()).rejects.toBeInstanceOf(TokenRenewalPendingError);
    expect(manager.signinSilent).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1_000);

    expect(manager.signinSilent).toHaveBeenCalledTimes(2);
    expect(renewal.getSnapshot()).toBe('idle');
    expect(onEnded).not.toHaveBeenCalled();
  });

  it('an attempt still in flight when stopped arms no retry: a stopped renewal stays quiet', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const manager = mockUserManager();
    let fail!: () => void;
    manager.signinSilent.mockImplementationOnce(
      () => new Promise((_, reject) => (fail = () => reject(new TypeError('Failed to fetch')))),
    );
    const { renewal, onEnded } = setup(manager);
    const attempt = renewal.renew();
    expect(manager.signinSilent).toHaveBeenCalledOnce();

    renewal.stop();
    fail();
    await expect(attempt).rejects.toBeInstanceOf(TokenRenewalPendingError);
    await vi.advanceTimersByTimeAsync(10 * 60_000);

    expect(manager.signinSilent).toHaveBeenCalledOnce();
    expect(onEnded).not.toHaveBeenCalled();
  });

  it('a transient OAuth error (server_error) is retried, not treated as the end', async () => {
    const manager = mockUserManager();
    manager.signinSilent.mockRejectedValueOnce(oauthError('server_error'));
    const { renewal, onEnded } = setup(manager);
    await expect(renewal.renew()).rejects.toBeInstanceOf(TokenRenewalPendingError);
    expect(onEnded).not.toHaveBeenCalled();
    expect(renewal.getSnapshot()).toBe('waiting');
  });

  it('a rejected refresh token (invalid_grant) ends the session once', async () => {
    const manager = mockUserManager();
    manager.signinSilent.mockRejectedValue(oauthError('invalid_grant'));
    const { renewal, onEnded } = setup(manager);

    await expect(renewal.getAccessToken()).rejects.toBeInstanceOf(SessionEndedError);

    expect(renewal.getSnapshot()).toBe('ended');
    expect(onEnded).toHaveBeenCalledOnce();
    // Later callers learn it without another refresh.
    await expect(renewal.getAccessToken()).rejects.toBeInstanceOf(SessionEndedError);
    expect(manager.signinSilent).toHaveBeenCalledOnce();
  });

  it('concurrent callers share one refresh (single-flight)', async () => {
    const manager = mockUserManager();
    let release!: () => void;
    manager.signinSilent.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve(fresh);
        }),
    );
    const { renewal } = setup(manager);

    const tokens = Promise.all([
      renewal.getAccessToken(),
      renewal.getAccessToken(),
      renewal.renew({ force: true }).then((u) => u.access_token),
    ]);
    await vi.waitFor(() => expect(manager.signinSilent).toHaveBeenCalled());
    release();

    await expect(tokens).resolves.toEqual(['new', 'new', 'new']);
    expect(manager.signinSilent).toHaveBeenCalledOnce();
  });

  it('reset clears an ended state after a fresh sign-in', async () => {
    const manager = mockUserManager();
    manager.signinSilent.mockRejectedValueOnce(oauthError('invalid_grant'));
    const { renewal } = setup(manager);
    await renewal.renew().catch(() => {});
    expect(renewal.getSnapshot()).toBe('ended');

    renewal.reset();

    expect(renewal.getSnapshot()).toBe('idle');
    await expect(renewal.renew()).resolves.toEqual(fresh);
  });
});

describe('isDefinitiveRenewalFailure', () => {
  it.each([
    [oauthError('invalid_grant'), true],
    [oauthError('invalid_client'), true],
    [oauthError('temporarily_unavailable'), false],
    [oauthError('server_error'), false],
    [new Error('Bad Request (400): {}'), true],
    [new Error('Unauthorized (401): {}'), true],
    [new Error('Service Unavailable (503): {}'), false],
    [new TypeError('Failed to fetch'), false],
    [Object.assign(new Error('Network timed out'), { name: 'ErrorTimeout' }), false],
    [null, false],
  ])('%s -> %s', (error, definitive) => {
    expect(isDefinitiveRenewalFailure(error)).toBe(definitive);
  });
});
