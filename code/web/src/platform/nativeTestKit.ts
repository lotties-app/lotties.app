// Test helpers for the native shell (never imported by the app): a fake Capacitor bridge global and
// an in-memory NativeShell whose events the test fires.
import { vi } from 'vitest';
import type { NativeShell, SharedFile, SystemBarsStyle } from './nativeShell';

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
  /** Files passed to `shareFile`, in order. */
  shared: SharedFile[];
  /** The URL `launchUrl` returns. */
  launch: string | undefined;
  /** The OS opens the app with `url` (appUrlOpen). */
  openAppUrl(url: string): void;
  /** The app returns to the foreground. */
  resume(): void;
  /** The system browser closed (browserFinished). */
  finishBrowser(): void;
  /** Android's back button (backButton), with whether the WebView can go back. */
  pressBack(canGoBack: boolean): void;
  /** Number of `exitApp` calls. */
  exits: number;
  /** Number of live listeners (both kinds). */
  listenerCount(): number;
}

export function fakeNativeShell(): FakeNativeShell {
  const urlListeners = new Set<(url: string) => void>();
  const finishedListeners = new Set<() => void>();
  const backListeners = new Set<(canGoBack: boolean) => void>();
  const resumeListeners = new Set<() => void>();
  const shell: FakeNativeShell = {
    opened: [],
    styles: [],
    launch: undefined,
    shared: [],
    exits: 0,
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
    onResume: async (listener) => {
      resumeListeners.add(listener);
      return () => resumeListeners.delete(listener);
    },
    launchUrl: async () => shell.launch,
    shareFile: vi.fn(async (file: SharedFile) => {
      shell.shared.push(file);
    }),
    setSystemBarsStyle: vi.fn(async (style: SystemBarsStyle) => {
      shell.styles.push(style);
    }),
    onBackButton: async (listener) => {
      backListeners.add(listener);
      return () => backListeners.delete(listener);
    },
    exitApp: vi.fn(async () => {
      shell.exits += 1;
    }),
    pressBack: (canGoBack) => backListeners.forEach((listener) => listener(canGoBack)),
    openAppUrl: (url) => urlListeners.forEach((listener) => listener(url)),
    resume: () => resumeListeners.forEach((listener) => listener()),
    finishBrowser: () => finishedListeners.forEach((listener) => listener()),
    listenerCount: () =>
      urlListeners.size + finishedListeners.size + backListeners.size + resumeListeners.size,
  };
  return shell;
}
