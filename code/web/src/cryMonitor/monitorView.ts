import type { CrySensitivity } from '../cry/sensitivity';
import type { BabyEvent, EventType } from '../db/models';
import { isAutoDetected } from '../events/cryDetection';
import type { InstallPlatform } from '../install/installPlatform';
import { typeIdsForKey } from '../now/eventFacts';
import { FUSSY_KEY } from '../now/fussyPattern';

/* Pure choices of the cry monitor's screens (which text, which spells), kept apart from the components. */

/**
 * The engine's thresholds (cry/sensitivity.ts, docs/design/35 section 3; a test keeps them equal), copied so
 * the page's chunk holds no engine code. The level meter is full at twice the chosen one.
 */
export const METER_THRESHOLDS: Readonly<Record<CrySensitivity, number>> = {
  less: 0.03,
  balanced: 0.02,
  more: 0.01,
};

/** The meter's fill (0..1) for a smoothed score at a sensitivity. */
export function meterFill(level: number, sensitivity: CrySensitivity): number {
  if (!Number.isFinite(level)) return 0;
  return Math.min(1, Math.max(0, level / (2 * METER_THRESHOLDS[sensitivity])));
}

export type DeniedSteps = 'chromium' | 'iosSafari' | 'macSafari' | 'firefox';

/** Which short "allow the microphone" steps fit this browser. */
export function deniedStepsFor(platform: InstallPlatform): DeniedSteps {
  if (platform.os === 'ios') return 'iosSafari';
  if (platform.browser === 'firefox') return 'firefox';
  if (platform.mac && platform.browser === 'safari') return 'macSafari';
  return 'chromium';
}

/** The "screen may turn off" note for this device (iOS needs 18.4+ for the installed app). */
export function wakeLockNoteKey(platform: InstallPlatform) {
  if (platform.os === 'ios') return 'cryMonitor.listening.wakeLock.ios' as const;
  if (platform.os === 'android') return 'cryMonitor.listening.wakeLock.android' as const;
  return 'cryMonitor.listening.wakeLock.generic' as const;
}

/** How many of today's monitor spells the page lists. */
export const RECENT_DETECTIONS = 5;

/** The cry monitor spells among `events`, newest first (at most five). */
export function recentDetections(
  events: readonly BabyEvent[],
  types: readonly EventType[],
): BabyEvent[] {
  const ids = typeIdsForKey(types, FUSSY_KEY);
  return events
    .filter((event) => ids.has(event.typeId) && !event.deletedAt && isAutoDetected(event))
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .slice(0, RECENT_DETECTIONS);
}
