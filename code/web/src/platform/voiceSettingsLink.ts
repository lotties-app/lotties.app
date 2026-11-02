import type { NativeShell } from './nativeShell';

/**
 * The link an Android voice shortcut opens the app with when the phone is not connected yet
 * (code/mobile/android/.../voice/VoiceRunner.kt `openSettings`): the app goes to Settings > Voice
 * assistants. Same scheme and host as the voice sign-in redirect, another path.
 */
export const VOICE_SETTINGS_LINK = 'app.lotties.app://siri/settings';
export const VOICE_SETTINGS_PATH = '/settings#voice-assistants';

/** Client-side navigation the BrowserRouter follows (it listens to popstate). */
function goTo(path: string): void {
  window.history.pushState(null, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

const isVoiceSettingsLink = (url: string | undefined): boolean =>
  url !== undefined && url.split(/[?#]/, 1)[0] === VOICE_SETTINGS_LINK;

/** Follows the link while the app runs and when it started the app. Returns the stop function. */
export function followVoiceSettingsLink(
  shell: Pick<NativeShell, 'onAppUrlOpen' | 'launchUrl'>,
  navigate: (path: string) => void = goTo,
): () => void {
  let stopped = false;
  let remove: (() => void) | undefined;
  const open = (url: string | undefined) => {
    if (!stopped && isVoiceSettingsLink(url)) navigate(VOICE_SETTINGS_PATH);
  };
  void shell
    .onAppUrlOpen(open)
    .then((stop) => {
      if (stopped) stop();
      else remove = stop;
    })
    .catch(() => {});
  void shell
    .launchUrl()
    .then(open)
    .catch(() => {});
  return () => {
    stopped = true;
    remove?.();
  };
}
