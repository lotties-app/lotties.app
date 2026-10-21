import { useEffect } from 'react';

/** The slice of the Screen Wake Lock API used here (feature-detected: absent in some browsers). */
interface WakeLockApi {
  request: (type: 'screen') => Promise<WakeLockSentinelLike>;
}
interface WakeLockSentinelLike {
  released: boolean;
  release: () => Promise<void>;
}

const wakeLockOf = (): WakeLockApi | undefined =>
  (navigator as Navigator & { wakeLock?: WakeLockApi }).wakeLock;

/** Whether this browser can keep the screen on. */
export const canKeepScreenOn = () => typeof navigator !== 'undefined' && !!wakeLockOf();

/**
 * Keeps the screen on while `enabled` (the night view). Requested on mount, released on unmount,
 * and requested again when the page becomes visible (browsers drop the lock when it is hidden).
 * Never throws: no support, a refusal (low battery, permission) or a failed release is ignored.
 */
export function useWakeLock(enabled: boolean): void {
  useEffect(() => {
    const api = wakeLockOf();
    if (!enabled || !api) return;
    let sentinel: WakeLockSentinelLike | null = null;
    let cancelled = false;

    const acquire = async () => {
      try {
        const lock = await api.request('screen');
        if (cancelled) {
          await lock.release().catch(() => undefined);
          return;
        }
        sentinel = lock;
      } catch {
        // Refused or unsupported right now: the night view works without it.
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible' && (!sentinel || sentinel.released)) {
        void acquire();
      }
    };

    void acquire();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibility);
      void sentinel?.release().catch(() => undefined);
      sentinel = null;
    };
  }, [enabled]);
}
