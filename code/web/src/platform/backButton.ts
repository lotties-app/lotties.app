import type { NativeShell } from './nativeShell';

/**
 * Android's back button in the store app: one step back in the app's history (the same entries the
 * router pushed), and only on the first page it closes the app. Without a listener Capacitor goes
 * back by itself but does nothing on the first page, which feels stuck. Returns the stop function.
 */
export function followBackButton(
  shell: Pick<NativeShell, 'onBackButton' | 'exitApp'>,
  history: Pick<History, 'back'> = window.history,
): () => void {
  let stopped = false;
  let remove: (() => void) | undefined;
  void shell
    .onBackButton((canGoBack) => {
      if (canGoBack) history.back();
      else void shell.exitApp();
    })
    .then((stop) => {
      if (stopped) stop();
      else remove = stop;
    });
  return () => {
    stopped = true;
    remove?.();
  };
}
