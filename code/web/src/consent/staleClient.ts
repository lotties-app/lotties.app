import { updatesSupported, whenInstalled } from '../pwa/updateStore';
import { reloadPage } from './reloadPage';

/*
 * A browser or installed PWA held on an old bundle while the server asks for a newer consent version
 * (docs/design/38-consent-and-terms.md section 10): one automatic attempt per session to get the new bundle, never a loop.
 * The service worker is asked for its script again (like Hub > Check for updates, pwa/updateStore.ts); a new version waiting is
 * told to take over (the SKIP_WAITING message pwa/sw/sw.ts listens for, as ReloadPrompt does); then the page reloads once.
 * The session flag is set before anything else: if the reload lands on the same old bundle, the consent screen shows the
 * update panel instead of trying again.
 */

const ATTEMPT_KEY = 'lotties.consent.stale-reload';

/** How long a waiting worker may take to take control before the page reloads anyway. */
const TAKEOVER_WAIT_MS = 5_000;

/**
 * Whether the automatic attempt was already made in this session. Storage that cannot be read counts as tried: without the flag
 * a loop could not be ruled out.
 */
export function staleReloadTried(): boolean {
  try {
    return window.sessionStorage.getItem(ATTEMPT_KEY) !== null;
  } catch {
    return true;
  }
}

/** Marks the attempt as made; `false` when it already was or the flag cannot be stored (then no attempt is made). */
export function claimStaleReload(): boolean {
  if (staleReloadTried()) return false;
  try {
    window.sessionStorage.setItem(ATTEMPT_KEY, '1');
    return window.sessionStorage.getItem(ATTEMPT_KEY) !== null;
  } catch {
    return false;
  }
}

/** Resolves when the page's controller changes (the new worker took over), or the wait runs out. */
function takeOver(worker: ServiceWorker): Promise<void> {
  return new Promise((resolve) => {
    const container = navigator.serviceWorker;
    const done = () => {
      container.removeEventListener('controllerchange', done);
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(done, TAKEOVER_WAIT_MS);
    container.addEventListener('controllerchange', done);
    worker.postMessage({ type: 'SKIP_WAITING' });
  });
}

/**
 * Asks the service worker for the latest bundle, lets a waiting version take over, then reloads the page. A failed check
 * (offline, no worker) still reloads once: without a worker the reload alone fetches the new page.
 */
export async function refreshToLatestBundle(): Promise<void> {
  try {
    if (updatesSupported()) {
      const registration = await navigator.serviceWorker.getRegistration();
      if (registration) {
        await registration.update();
        if (registration.installing) await whenInstalled(registration.installing);
        if (registration.waiting) await takeOver(registration.waiting);
      }
    }
  } catch (error) {
    console.warn('Could not fetch the latest version', error);
  }
  reloadPage();
}

/** The automatic attempt of this session: `true` when the page is reloading, `false` when it was already made (show the panel). */
export async function attemptStaleReload(): Promise<boolean> {
  if (!claimStaleReload()) return false;
  await refreshToLatestBundle();
  return true;
}
