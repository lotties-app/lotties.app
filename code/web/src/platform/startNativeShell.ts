import { followBackButton } from './backButton';
import { capacitorShell, type NativeShell } from './nativeShell';
import { followThemeWithSystemBars } from './systemBars';

/**
 * Native-only start-up, loaded lazily by main.tsx when `isNativeApp()`. Sign-in redirects are
 * handled by the auth provider (auth/nativeAuth.ts); the bundled assets replace the service worker.
 * Android's back button walks the app's history and closes the app only at the first page.
 * Returns the stop function (the app never stops it).
 */
export function startNativeShell(shell: NativeShell = capacitorShell): () => void {
  const stopBars = followThemeWithSystemBars(document.documentElement, shell.setSystemBarsStyle);
  const stopBack = followBackButton(shell);
  return () => {
    stopBars();
    stopBack();
  };
}
