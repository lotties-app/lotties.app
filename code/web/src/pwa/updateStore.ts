import { useSyncExternalStore } from 'react';
import { isNativeApp } from '../platform/nativeApp';

/*
 * The app update check (Hub > Check for updates). ReloadPrompt registers the service worker and
 * feeds this store with its registration, "a new version is waiting" and the reload function; the
 * screen reads the state and asks for a check. Plain module state, so the service worker is
 * registered exactly once.
 */

export type UpdateState =
  /** Nothing asked yet. */
  | 'idle'
  | 'checking'
  | 'upToDate'
  /** A new version is installed and waiting: reloading switches to it. */
  | 'ready'
  | 'error'
  /** No service worker here: the native app (store releases) or a browser without one. */
  | 'unsupported';

export interface UpdateSnapshot {
  state: UpdateState;
  /** When the last successful check ended (ms), for "Checked at ...". */
  checkedAt: number | null;
}

/** How long a freshly found worker may take to install before the check calls it done. */
const INSTALL_WAIT_MS = 20_000;

let snapshot: UpdateSnapshot = { state: 'idle', checkedAt: null };
let registration: ServiceWorkerRegistration | undefined;
let reload: ((reloadPage?: boolean) => Promise<void>) | undefined;
let waiting = false;
const listeners = new Set<() => void>();

function publish(next: Partial<UpdateSnapshot>) {
  snapshot = { ...snapshot, ...next };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Whether this runtime can have a service worker at all. */
export function updatesSupported(): boolean {
  return !isNativeApp() && typeof navigator !== 'undefined' && 'serviceWorker' in navigator;
}

/** Called by ReloadPrompt once the worker is registered. */
export function setRegistration(next: ServiceWorkerRegistration | undefined) {
  registration = next;
}

/** Called by ReloadPrompt with the library's "reload into the new version" function. */
export function setReload(fn: ((reloadPage?: boolean) => Promise<void>) | undefined) {
  reload = fn;
}

/** Called by ReloadPrompt whenever the library says a new version is (no longer) waiting. */
export function setWaiting(next: boolean) {
  waiting = next;
  if (next) publish({ state: 'ready' });
  else if (snapshot.state === 'ready') publish({ state: 'idle' });
}

/** Resolves when the worker finishes installing (or fails, or the wait runs out). */
function whenInstalled(worker: ServiceWorker): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      worker.removeEventListener('statechange', onChange);
      clearTimeout(timer);
      resolve();
    };
    const onChange = () => {
      if (worker.state !== 'installing') done();
    };
    const timer = setTimeout(done, INSTALL_WAIT_MS);
    if (worker.state !== 'installing') done();
    else worker.addEventListener('statechange', onChange);
  });
}

/**
 * Asks the browser to fetch the service worker script again. Ends in `ready` when a new version is
 * installed and waiting, `upToDate` when there is none, `error` when the check itself failed
 * (offline, server unreachable).
 */
export async function checkForUpdates(): Promise<void> {
  if (!updatesSupported()) {
    publish({ state: 'unsupported' });
    return;
  }
  if (snapshot.state === 'checking') return;
  if (waiting) {
    publish({ state: 'ready' });
    return;
  }
  publish({ state: 'checking' });
  try {
    const current =
      registration ??
      (await navigator.serviceWorker.getRegistration()) ??
      (await navigator.serviceWorker.ready);
    await current.update();
    if (current.installing) await whenInstalled(current.installing);
    if (waiting || current.waiting) publish({ state: 'ready', checkedAt: Date.now() });
    else publish({ state: 'upToDate', checkedAt: Date.now() });
  } catch (error) {
    console.warn('Update check failed', error);
    publish({ state: 'error' });
  }
}

/** Activates the waiting version and reloads the page. */
export async function applyUpdate(): Promise<void> {
  if (reload) await reload(true);
  else window.location.reload();
}

export function useUpdateSnapshot(): UpdateSnapshot {
  const current = useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => snapshot,
  );
  if (!updatesSupported() && current.state !== 'unsupported') {
    return { ...current, state: 'unsupported' };
  }
  return current;
}

/** Test seam: back to the initial state. */
export function resetUpdateStore() {
  snapshot = { state: 'idle', checkedAt: null };
  registration = undefined;
  reload = undefined;
  waiting = false;
  for (const listener of listeners) listener();
}
