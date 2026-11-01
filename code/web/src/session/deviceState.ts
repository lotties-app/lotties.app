import { forgetSelectedBaby } from '../baby/selectedBabyStorage';
import { clearConsentState } from '../consent/consentStorage';
import { clearCryMonitorConsent } from '../cryMonitor/monitorStorage';
import { clearDashboardState } from '../doctor/dashboardStorage';
import { clearAllLastUsed } from '../events/lastUsedValues';
import { localPushDeviceRecord } from '../notifications/pushDeviceRecord';
import { clearUnitSetting } from '../units/unitSettingStorage';
import { clearPromptDismissed } from '../notifications/reminderPrompt';
import { clearAllBellyDismissals } from '../now/bellyPatternDismissal';
import { bottleFollowUpDismissal } from '../now/bottleFollowUp';
import {
  diaperDirtyDismissal,
  diaperWetDismissal,
  fussyDismissal,
  overtiredDismissal,
} from '../now/dismissalStore';
import { clearAllLastSeen } from '../now/lastSeen';
import { clearAllCachedPredictions } from '../predictions/predictionsCache';
import { clearAllPinned } from '../presets/pinnedStorage';
import { clearTimeBottles } from '../presets/timeBottlesStorage';

/** Which account (its database name, not the raw subject) the entries below belong to. */
const ACCOUNT_KEY = 'baby-routine.account';

/**
 * Removes the account's localStorage entries: the selected baby, the cached predictions, the pinned
 * presets, the "Time bottle feedings" setting, the measurement-units choice, the last accepted consent and the policy notice seen, the doctor dashboard's remembered patients and mode, the remembered field values, the Now "last seen" times, the belly pain and fussy
 * pattern cards' "Not today" and the overtired and diaper cards' "Not now" (all keyed by baby), this device's
 * push opt-in, the reminder card's "Not now" and the cry monitor's consent on this device.
 * Device preferences such as the theme (and the cry monitor's sensitivity) are kept.
 */
export function clearAccountDeviceState(): void {
  forgetSelectedBaby();
  clearCryMonitorConsent();
  clearDashboardState();
  clearAllCachedPredictions();
  clearAllPinned();
  clearTimeBottles();
  clearUnitSetting();
  clearConsentState();
  clearAllLastUsed();
  clearAllLastSeen();
  clearAllBellyDismissals();
  fussyDismissal.clearAll();
  overtiredDismissal.clearAll();
  diaperWetDismissal.clearAll();
  diaperDirtyDismissal.clearAll();
  bottleFollowUpDismissal.clearAll();
  localPushDeviceRecord.clear();
  clearPromptDismissed();
  try {
    window.localStorage.removeItem(ACCOUNT_KEY);
  } catch {
    // Storage unavailable: nothing was saved.
  }
}

/**
 * Records `owner` (the account's database name) as the owner of the per-account localStorage entries, clearing them first
 * when they belong to another account (a different user signed in without signing out) or to an
 * unknown one (saved before this marker existed). Idempotent.
 */
export function claimDeviceState(owner: string): void {
  try {
    if (window.localStorage.getItem(ACCOUNT_KEY) === owner) return;
    clearAccountDeviceState();
    window.localStorage.setItem(ACCOUNT_KEY, owner);
  } catch {
    // Storage unavailable: there is no saved state to protect.
  }
}
