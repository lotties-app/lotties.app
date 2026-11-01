/**
 * Night feed decision logic: pure functions (no React, no storage) so the rules are testable with
 * fixed dates. The window is local time from 22:00 to 05:00.
 */

/** Off: never suggest. Ask: offer in the window. Auto: switch in the window and back after. */
export type NightFeedSetting = 'off' | 'ask' | 'auto';
export const NIGHT_FEED_SETTINGS: readonly NightFeedSetting[] = ['off', 'ask', 'auto'];
export const DEFAULT_NIGHT_FEED_SETTING: NightFeedSetting = 'ask';

export const NIGHT_START_HOUR = 22;
export const NIGHT_END_HOUR = 5;

/** An explicit choice (banner "Switch", quick toggle). It is valid only inside the period `key`. */
export interface NightOverride {
  on: boolean;
  key: string;
}

export interface NightFeedState {
  override: NightOverride | null;
  /** Period key whose banner the user dismissed ("Not now"). */
  dismissedKey: string | null;
}

export interface NightFeedDecision {
  /** The night scheme should be shown. */
  active: boolean;
  /** The "Switch to night view?" banner should be shown. */
  suggest: boolean;
  /** Identifies the current period (changes at 22:00 and at 05:00). */
  key: string;
}

export function isInNightWindow(now: Date): boolean {
  const hour = now.getHours();
  return hour >= NIGHT_START_HOUR || hour < NIGHT_END_HOUR;
}

const pad = (n: number) => String(n).padStart(2, '0');
const localDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/**
 * `n:<date>` for a night window (named after the evening it started, so 01:00 belongs to the
 * previous date) and `d:<date>` for the day in between. Choices expire when the key changes,
 * which is "until the next window boundary".
 */
export function nightPeriodKey(now: Date): string {
  if (!isInNightWindow(now)) return `d:${localDate(now)}`;
  const start = new Date(now);
  if (now.getHours() < NIGHT_START_HOUR) start.setDate(start.getDate() - 1);
  return `n:${localDate(start)}`;
}

export function decideNightFeed(
  setting: NightFeedSetting,
  now: Date,
  state: NightFeedState,
): NightFeedDecision {
  const key = nightPeriodKey(now);
  const inWindow = isInNightWindow(now);
  const explicit = state.override?.key === key ? state.override.on : undefined;
  return {
    key,
    active: explicit ?? (setting === 'auto' && inWindow),
    suggest: setting === 'ask' && inWindow && explicit === undefined && state.dismissedKey !== key,
  };
}
