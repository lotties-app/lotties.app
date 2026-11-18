import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { reloadPage } from './reloadPage';
import { attemptStaleReload, claimStaleReload, staleReloadTried } from './staleClient';

/* The one automatic attempt of a stale browser to get the latest bundle (docs/design/38-consent-and-terms.md section 10). */

vi.mock('./reloadPage', () => ({ reloadPage: vi.fn() }));

interface FakeWorker {
  postMessage: ReturnType<typeof vi.fn>;
}

/** A service worker container whose registration finds a new version waiting; SKIP_WAITING makes it take control. */
function fakeServiceWorker(waiting: boolean) {
  const container = new EventTarget();
  const worker: FakeWorker = {
    postMessage: vi.fn((message: { type?: string }) => {
      if (message.type === 'SKIP_WAITING') container.dispatchEvent(new Event('controllerchange'));
    }),
  };
  const registration = {
    update: vi.fn(async () => undefined),
    installing: null,
    waiting: waiting ? worker : null,
  };
  Object.assign(container, { getRegistration: vi.fn(async () => registration) });
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: container });
  return { registration, worker };
}

beforeEach(() => {
  window.sessionStorage.clear();
  vi.mocked(reloadPage).mockClear();
});

afterEach(() => {
  Reflect.deleteProperty(navigator, 'serviceWorker');
  vi.restoreAllMocks();
});

describe('attemptStaleReload', () => {
  it('fetches the worker again, lets the waiting version take over, then reloads once', async () => {
    const { registration, worker } = fakeServiceWorker(true);

    expect(await attemptStaleReload()).toBe(true);

    expect(registration.update).toHaveBeenCalledTimes(1);
    expect(worker.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
    expect(reloadPage).toHaveBeenCalledTimes(1);
    expect(staleReloadTried()).toBe(true);
  });

  it('reloads without a message when no new version is waiting', async () => {
    const { registration } = fakeServiceWorker(false);

    expect(await attemptStaleReload()).toBe(true);

    expect(registration.update).toHaveBeenCalledTimes(1);
    expect(reloadPage).toHaveBeenCalledTimes(1);
  });

  it('still reloads once when the check fails (offline)', async () => {
    const { registration } = fakeServiceWorker(true);
    registration.update.mockRejectedValueOnce(new Error('offline'));
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    expect(await attemptStaleReload()).toBe(true);
    expect(reloadPage).toHaveBeenCalledTimes(1);
  });

  it('makes one attempt per session, never a loop', async () => {
    fakeServiceWorker(false);

    expect(await attemptStaleReload()).toBe(true);
    expect(await attemptStaleReload()).toBe(false);
    expect(reloadPage).toHaveBeenCalledTimes(1);
  });

  it('makes none when the session flag cannot be kept', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });

    expect(claimStaleReload()).toBe(false);
    expect(await attemptStaleReload()).toBe(false);
    expect(reloadPage).not.toHaveBeenCalled();
  });
});
