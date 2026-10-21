// Captures the browser's install prompt (beforeinstallprompt) as early as possible: the event
// can fire before any React component mounts, so the listener lives at module level.

/** Chromium-only event; not in the standard DOM lib typings. */
export interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
  prompt(): Promise<void>;
}

export type InstallPromptSnapshot = {
  deferred: BeforeInstallPromptEvent | null;
  installed: boolean;
};

export type InstallOutcome = 'accepted' | 'dismissed' | 'unavailable';

type NavigatorWithStandalone = Navigator & { standalone?: boolean };

export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const displayStandalone = window.matchMedia?.('(display-mode: standalone)')?.matches === true;
  // iOS Safari exposes standalone mode through navigator.standalone instead of display-mode.
  return displayStandalone || (navigator as NavigatorWithStandalone).standalone === true;
}

/** iPhone/iPad/iPod Safari (not Chrome, Firefox or Edge on iOS, which cannot add to home screen). */
export function isIosSafari(userAgent: string = navigator.userAgent): boolean {
  const isIos = /iPhone|iPad|iPod/i.test(userAgent);
  const isSafari = /Safari/i.test(userAgent) && !/CriOS|FxiOS|EdgiOS|OPiOS/i.test(userAgent);
  return isIos && isSafari;
}

let snapshot: InstallPromptSnapshot = { deferred: null, installed: isStandalone() };
const listeners = new Set<() => void>();

function update(next: InstallPromptSnapshot) {
  snapshot = next;
  listeners.forEach((listener) => listener());
}

export function subscribeInstallPrompt(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getInstallPromptSnapshot(): InstallPromptSnapshot {
  return snapshot;
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => {
    // Keep the browser's mini-infobar away; the app shows its own button instead.
    event.preventDefault();
    update({ ...snapshot, deferred: event as BeforeInstallPromptEvent });
  });
  window.addEventListener('appinstalled', () => {
    update({ deferred: null, installed: true });
  });
}

/** Shows the native install dialog. The prompt can only be used once, so it is cleared first. */
export async function promptInstall(): Promise<InstallOutcome> {
  const deferred = snapshot.deferred;
  if (!deferred) return 'unavailable';
  update({ ...snapshot, deferred: null });
  await deferred.prompt();
  const { outcome } = await deferred.userChoice;
  return outcome;
}
