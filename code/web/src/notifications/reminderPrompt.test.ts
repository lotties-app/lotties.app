import { describe, expect, it } from 'vitest';
import {
  clearPromptDismissed,
  PROMPT_SNOOZE_MS,
  readPromptDismissedAt,
  shouldOfferDoseReminders,
  writePromptDismissedAt,
  type ReminderOfferFacts,
} from './reminderPrompt';

const NOW = new Date('2026-10-21T12:00:00Z');
const facts = (over: Partial<ReminderOfferFacts> = {}): ReminderOfferFacts => ({
  serverEnabled: true,
  support: 'supported',
  permission: 'default',
  subscribed: false,
  doseDueOn: false,
  canReceive: true,
  dismissedAt: null,
  now: NOW,
  ...over,
});

describe('shouldOfferDoseReminders', () => {
  it('offers where push works and reminders are not on yet', () => {
    expect(shouldOfferDoseReminders(facts())).toBe(true);
    expect(shouldOfferDoseReminders(facts({ permission: 'granted' }))).toBe(true);
    // Device on, medicine reminders off for this baby: still worth offering.
    expect(shouldOfferDoseReminders(facts({ permission: 'granted', subscribed: true }))).toBe(true);
  });

  it('never offers when unsupported, off on the server, blocked, for a viewer, or already on', () => {
    expect(shouldOfferDoseReminders(facts({ serverEnabled: false }))).toBe(false);
    for (const support of ['unsupported', 'ios-needs-install', 'ios-too-old'] as const) {
      expect(shouldOfferDoseReminders(facts({ support }))).toBe(false);
    }
    expect(shouldOfferDoseReminders(facts({ permission: 'denied' }))).toBe(false);
    expect(shouldOfferDoseReminders(facts({ canReceive: false }))).toBe(false);
    expect(
      shouldOfferDoseReminders(facts({ permission: 'granted', subscribed: true, doseDueOn: true })),
    ).toBe(false);
  });

  it('stays hidden for 30 days after Not now', () => {
    const recent = new Date(NOW.getTime() - PROMPT_SNOOZE_MS + 60_000);
    const old = new Date(NOW.getTime() - PROMPT_SNOOZE_MS);
    expect(shouldOfferDoseReminders(facts({ dismissedAt: recent }))).toBe(false);
    expect(shouldOfferDoseReminders(facts({ dismissedAt: old }))).toBe(true);
  });
});

describe('prompt dismissal storage', () => {
  it('round-trips and clears', () => {
    expect(readPromptDismissedAt()).toBeNull();
    writePromptDismissedAt(NOW);
    expect(readPromptDismissedAt()).toEqual(NOW);
    clearPromptDismissed();
    expect(readPromptDismissedAt()).toBeNull();
  });

  it('ignores a malformed value', () => {
    window.localStorage.setItem('baby-routine.push-prompt-dismissed', 'soon');
    expect(readPromptDismissedAt()).toBeNull();
  });
});
