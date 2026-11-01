import type { CrySensitivity } from '../cry/sensitivity';

/*
 * What the cry monitor keeps on this device (docs/design/35-cry-engine.md section 8):
 * - the consent: the version of the consent text the person agreed to and when. Per account: it is
 *   cleared with the account's other entries at sign-out (session/deviceState.ts) and asked again when
 *   the text's version changes;
 * - the sensitivity: a device preference (where the device sits matters, not who signed in), kept like
 *   the theme.
 * Storage may be unavailable (private mode): reads then say "no consent" and "default sensitivity".
 */

/** Raise when the meaning of the consent text changes (cryMonitor.consent.* in both catalogs). */
export const CRY_MONITOR_CONSENT_VERSION = 1;

const CONSENT_KEY = 'lotties.cry-monitor.consent';
const SENSITIVITY_KEY = 'lotties.cry-monitor.sensitivity';

/** The levels, in the order the control shows them (the engine's thresholds, docs/design/35 section 3). */
export const SENSITIVITIES: readonly CrySensitivity[] = ['less', 'balanced', 'more'];
const DEFAULT_SENSITIVITY: CrySensitivity = 'balanced';

export interface CryMonitorConsent {
  version: number;
  /** ISO time of the agreement. */
  at: string;
}

export function readConsent(): CryMonitorConsent | null {
  try {
    const raw = window.localStorage.getItem(CONSENT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CryMonitorConsent> | null;
    if (
      !parsed ||
      typeof parsed.version !== 'number' ||
      typeof parsed.at !== 'string' ||
      !Number.isFinite(Date.parse(parsed.at))
    ) {
      return null;
    }
    return { version: parsed.version, at: parsed.at };
  } catch {
    return null;
  }
}

/** Whether the person agreed on this device to the current text. */
export function hasCurrentConsent(): boolean {
  return readConsent()?.version === CRY_MONITOR_CONSENT_VERSION;
}

export function writeConsent(now: Date = new Date()): CryMonitorConsent {
  const consent = { version: CRY_MONITOR_CONSENT_VERSION, at: now.toISOString() };
  try {
    window.localStorage.setItem(CONSENT_KEY, JSON.stringify(consent));
  } catch {
    // Storage unavailable: the consent is asked again next time.
  }
  return consent;
}

/** Withdraws the consent on this device (also part of the sign-out clean-up). */
export function clearCryMonitorConsent(): void {
  try {
    window.localStorage.removeItem(CONSENT_KEY);
  } catch {
    // Storage unavailable: nothing was saved.
  }
}

export function readSensitivity(): CrySensitivity {
  try {
    const raw = window.localStorage.getItem(SENSITIVITY_KEY);
    return SENSITIVITIES.find((level) => level === raw) ?? DEFAULT_SENSITIVITY;
  } catch {
    return DEFAULT_SENSITIVITY;
  }
}

export function writeSensitivity(level: CrySensitivity): void {
  try {
    window.localStorage.setItem(SENSITIVITY_KEY, level);
  } catch {
    // Storage unavailable: the default comes back next time.
  }
}
