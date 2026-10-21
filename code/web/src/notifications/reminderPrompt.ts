import type { BrowserPermission } from './permissionState';
import type { PushSupport } from './pushSupport';

/*
 * The one-time card offering medicine reminders after a scheduled prescription is saved
 * (docs/design/09-push-notifications.md section 11). "Not now" hides it on this device for 30
 * days; the entry is per account (cleared with the account's other localStorage entries).
 */

const KEY = 'baby-routine.push-prompt-dismissed';
const DAY_MS = 24 * 60 * 60_000;
export const PROMPT_SNOOZE_MS = 30 * DAY_MS;

export interface ReminderOfferFacts {
  serverEnabled: boolean;
  support: PushSupport;
  permission: BrowserPermission;
  /** This browser holds a push subscription. */
  subscribed: boolean;
  /** Medicine reminders are on for this baby (server preferences). */
  doseDueOn: boolean;
  /** Owner or Parent (Viewers never get reminders). */
  canReceive: boolean;
  /** When "Not now" was chosen last, if ever. */
  dismissedAt: Date | null;
  now: Date;
}

/** Offer only where it can work and is not on yet, and not within 30 days of "Not now". */
export function shouldOfferDoseReminders(facts: ReminderOfferFacts): boolean {
  if (!facts.serverEnabled || facts.support !== 'supported') return false;
  if (facts.permission === 'denied' || !facts.canReceive) return false;
  if (facts.subscribed && facts.doseDueOn) return false;
  const dismissed = facts.dismissedAt?.getTime();
  return dismissed === undefined || facts.now.getTime() - dismissed >= PROMPT_SNOOZE_MS;
}

export function readPromptDismissedAt(): Date | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    const ms = raw ? Date.parse(raw) : NaN;
    return Number.isFinite(ms) ? new Date(ms) : null;
  } catch {
    return null;
  }
}

export function writePromptDismissedAt(at: Date): void {
  try {
    window.localStorage.setItem(KEY, at.toISOString());
  } catch {
    // Storage unavailable: the card may show again after the next save.
  }
}

export function clearPromptDismissed(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // Storage unavailable: nothing was saved.
  }
}
