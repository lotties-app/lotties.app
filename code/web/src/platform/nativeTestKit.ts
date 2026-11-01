// Test helpers for the native shell (never imported by the app): a fake Capacitor bridge global and
// an in-memory NativeShell whose events the test fires.
import { vi } from 'vitest';
import type { NativeShell, SystemBarsStyle } from './nativeShell';

/** Makes `isNativeApp()` true, like the bridge the Capacitor shell injects. Returns the undo. */
export function pretendNativeApp(): () => void {
  const scope = globalThis as { Capacitor?: unknown };
  const previous = scope.Capacitor;
  scope.Capacitor = { isNativePlatform: () => true };
  return () => {
    if (previous === undefined) delete scope.Capacitor;
    else scope.Capacitor = previous;
  };
}

export interface FakeNativeShell extends NativeShell {
  /** URLs passed to `openBrowser`, in order. */
  opened: string[];
  styles: SystemBarsStyle[];
  /** The URL `launchUrl` returns. */
  launch: string | undefined;
  /** The OS opens the app with `url` (appUrlOpen). */
  openAppUrl(url: string): void;
  /** The system browser closed (browserFinished). */
  finishBrowser(): void;
  /** Number of live listeners (both kinds). */
  listenerCount(): number;
}

export function fakeNativeShell(): FakeNativeShell {
  const urlListeners = new Set<(url: string) => void>();
  const finishedListeners = new Set<() => void>();
  const shell: FakeNativeShell = {
    opened: [],
    styles: [],
    launch: undefined,
    openBrowser: vi.fn(async (url: string) => {
      shell.opened.push(url);
    }),
    closeBrowser: vi.fn(async () => {}),
    onBrowserFinished: async (listener) => {
      finishedListeners.add(listener);
      return () => finishedListeners.delete(listener);
    },
    onAppUrlOpen: async (listener) => {
      urlListeners.add(listener);
      return () => urlListeners.delete(listener);
    },
    launchUrl: async () => shell.launch,
    setSystemBarsStyle: vi.fn(async (style: SystemBarsStyle) => {
      shell.styles.push(style);
    }),
    openAppUrl: (url) => urlListeners.forEach((listener) => listener(url)),
    finishBrowser: () => finishedListeners.forEach((listener) => listener()),
    listenerCount: () => urlListeners.size + finishedListeners.size,
  };
  return shell;
}
