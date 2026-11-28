import { cryMonitorEnabled } from './featureFlag';
import { clearCryMonitorConsent } from './monitorStorage';

/*
 * Run once at app start (src/main.tsx; docs/design/35-cry-engine.md section 9). While the cry monitor is
 * switched off its page cannot be reached, so nobody may keep a consent they can no longer withdraw
 * there: this device's consent record is removed. Switched on, it stays untouched. The sensitivity is a
 * device preference and stays. Small on purpose: no monitor page or engine code in the start-up chunk.
 */
export function clearCryConsentWhileSwitchedOff(enabled: boolean = cryMonitorEnabled()): void {
  if (!enabled) clearCryMonitorConsent();
}
