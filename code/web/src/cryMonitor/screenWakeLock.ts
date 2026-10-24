/*
 * Keeps the screen on while the cry monitor runs (Screen Wake Lock API). The browser releases the lock
 * whenever the page is hidden (and may on low battery), so it is requested again each time the page
 * becomes visible. The page shows a quiet warning when the API is missing (older browsers; Home Screen
 * web apps before iOS 18.4) or the request is refused. Never throws.
 */

export type WakeLockStatus = 'off' | 'on' | 'unsupported' | 'denied';

export interface WakeLockSentinelLike {
  released: boolean;
  release: () => Promise<void>;
}

export interface WakeLockApiLike {
  request: (type: 'screen') => Promise<WakeLockSentinelLike>;
}

export interface WakeLockEnvironment {
  wakeLock: WakeLockApiLike | undefined;
  visibility: () => DocumentVisibilityState;
  onVisibilityChange: (listener: () => void) => () => void;
}

export function browserWakeLockEnvironment(): WakeLockEnvironment {
  return {
    wakeLock:
      typeof navigator === 'undefined'
        ? undefined
        : (navigator as Navigator & { wakeLock?: WakeLockApiLike }).wakeLock,
    visibility: () => document.visibilityState,
    onVisibilityChange: (listener) => {
      document.addEventListener('visibilitychange', listener);
      return () => document.removeEventListener('visibilitychange', listener);
    },
  };
}

export class ScreenWakeLock {
  private readonly env: WakeLockEnvironment;
  private readonly onStatus: (status: WakeLockStatus) => void;
  private sentinel: WakeLockSentinelLike | null = null;
  private active = false;
  private stopWatching: (() => void) | null = null;
  private current: WakeLockStatus = 'off';

  constructor(env: WakeLockEnvironment, onStatus: (status: WakeLockStatus) => void) {
    this.env = env;
    this.onStatus = onStatus;
  }

  get status(): WakeLockStatus {
    return this.current;
  }

  /** Requests the lock now and again whenever the page comes back. */
  start(): void {
    if (this.active) return;
    this.active = true;
    if (!this.env.wakeLock) {
      this.set('unsupported');
      return;
    }
    this.stopWatching = this.env.onVisibilityChange(() => {
      if (this.env.visibility() === 'visible' && (!this.sentinel || this.sentinel.released)) {
        void this.acquire();
      }
    });
    void this.acquire();
  }

  /** Releases the lock and stops watching. */
  stop(): void {
    this.active = false;
    this.stopWatching?.();
    this.stopWatching = null;
    const sentinel = this.sentinel;
    this.sentinel = null;
    void sentinel?.release().catch(() => undefined);
    this.set('off');
  }

  private async acquire(): Promise<void> {
    const api = this.env.wakeLock;
    if (!api) return;
    try {
      const lock = await api.request('screen');
      if (!this.active) {
        await lock.release().catch(() => undefined);
        return;
      }
      this.sentinel = lock;
      this.set('on');
    } catch {
      // Refused (no user activation, low battery, a policy) or hidden meanwhile: warn quietly.
      if (this.active) this.set('denied');
    }
  }

  private set(status: WakeLockStatus): void {
    if (status === this.current) return;
    this.current = status;
    this.onStatus(status);
  }
}
