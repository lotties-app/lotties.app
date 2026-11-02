import { followBackButton } from './backButton';
import { capacitorShell, type NativeShell } from './nativeShell';
import { followThemeWithSystemBars } from './systemBars';
import { followVoiceSettingsLink } from './voiceSettingsLink';

/**
 * Native-only start-up, loaded lazily by main.tsx when `isNativeApp()`. Sign-in redirects are
 * handled by the auth provider (auth/nativeAuth.ts); the bundled assets replace the service worker.
 * Android's back button walks the app's history and closes the app only at the first page. The
 * Android voice shortcuts' "connect first" link opens Settings > Voice assistants.
 * Returns the stop function (the app never stops it).
 */
export function startNativeShell(shell: NativeShell = capacitorShell): () => void {
  const stopBars = followThemeWithSystemBars(document.documentElement, shell.setSystemBarsStyle);
  const stopBack = followBackButton(shell);
  const stopVoice = followVoiceSettingsLink(shell);
  return () => {
    stopBars();
    stopBack();
    stopVoice();
  };
}
