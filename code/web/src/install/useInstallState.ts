import { useMemo, useSyncExternalStore } from 'react';
import { isNativeApp } from '../platform/nativeApp';
import {
  getInstallPromptSnapshot,
  promptInstall,
  subscribeInstallPrompt,
  type InstallOutcome,
} from '../pwa/installPrompt';
import {
  currentInstallPlatform,
  guideFor,
  type GuideId,
  type InstallPlatform,
} from './installPlatform';

export interface InstallState {
  /** Inside the iOS/Android store app (Capacitor): nothing to install, nothing install-related shown. */
  native: boolean;
  /** Running as the installed app (display-mode standalone, `navigator.standalone`, or just installed). */
  installed: boolean;
  /** The browser offered its install prompt (`beforeinstallprompt`) and it was not used yet. */
  canPrompt: boolean;
  platform: InstallPlatform;
  /** The manual steps for this browser, used when there is no prompt. */
  guide: GuideId;
  /** Shows the browser's install dialog (once per prompt). */
  install: () => Promise<InstallOutcome>;
}

/** The install situation of this browser, live: the prompt and `appinstalled` update it. */
export function useInstallState(): InstallState {
  const snapshot = useSyncExternalStore(
    subscribeInstallPrompt,
    getInstallPromptSnapshot,
    getInstallPromptSnapshot,
  );
  const platform = useMemo(() => currentInstallPlatform(), []);
  const native = isNativeApp();
  const installed = snapshot.installed;
  return {
    native,
    installed,
    canPrompt: !native && !installed && snapshot.deferred !== null,
    platform,
    guide: guideFor(platform),
    install: promptInstall,
  };
}
