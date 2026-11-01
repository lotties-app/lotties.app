import { useSyncExternalStore } from 'react';
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

export function useInstallPrompt(): InstallPromptState {
  const { deferred, installed } = useSyncExternalStore(
    subscribeInstallPrompt,
    getInstallPromptSnapshot,
    getInstallPromptSnapshot,
  );
  return {
    canInstall: !installed && deferred !== null,
    showIosHint: !installed && isIosSafari(),
    install: promptInstall,
  };
}
