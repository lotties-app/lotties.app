import { useSyncExternalStore } from 'react';
import { isNativeApp } from '../platform/nativeApp';
import {
  getInstallPromptSnapshot,
  isIosSafari,
  promptInstall,
  subscribeInstallPrompt,
  type InstallOutcome,
} from './installPrompt';

export interface InstallPromptState {
  /** True when the browser offered an install prompt and the app is not installed yet. */
  canInstall: boolean;
  /** True on iOS Safari outside standalone mode, where install is manual (Share, then Add to Home Screen). */
  showIosHint: boolean;
  install: () => Promise<InstallOutcome>;
}

/** Inside the iOS/Android app (`isNativeApp()`) there is nothing to install: no prompt, no hint. */
export function useInstallPrompt(): InstallPromptState {
  const snapshot = useSyncExternalStore(
    subscribeInstallPrompt,
    getInstallPromptSnapshot,
    getInstallPromptSnapshot,
  );
  const installed = snapshot.installed || isNativeApp();
  return {
    canInstall: !installed && snapshot.deferred !== null,
    showIosHint: !installed && isIosSafari(),
    install: promptInstall,
  };
}
