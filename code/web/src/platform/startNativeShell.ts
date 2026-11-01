import { capacitorShell, type NativeShell } from './nativeShell';
import { followThemeWithSystemBars } from './systemBars';

/**
 * Native-only start-up, loaded lazily by main.tsx when `isNativeApp()`. Sign-in redirects are
 * handled by the auth provider (auth/nativeAuth.ts); the bundled assets replace the service worker.
 * Returns the stop function (the app never stops it).
 */
export function startNativeShell(shell: NativeShell = capacitorShell): () => void {
  return followThemeWithSystemBars(document.documentElement, shell.setSystemBarsStyle);
}
