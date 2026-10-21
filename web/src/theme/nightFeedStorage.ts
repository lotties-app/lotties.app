import {
  DEFAULT_NIGHT_FEED_SETTING,
  NIGHT_FEED_SETTINGS,
  type NightFeedSetting,
  type NightFeedState,
} from './nightFeed';

export const NIGHT_FEED_STORAGE_KEY = 'baby-routine.nightFeed';
export const NIGHT_FEED_STATE_STORAGE_KEY = 'baby-routine.nightFeed.state';

export const EMPTY_NIGHT_FEED_STATE: NightFeedState = { override: null, dismissedKey: null };

/** The stored setting; anything unknown (or no value) is the default, "ask". */
export function loadNightFeedSetting(): NightFeedSetting {
  try {
    const value = window.localStorage.getItem(NIGHT_FEED_STORAGE_KEY);
    return NIGHT_FEED_SETTINGS.includes(value as NightFeedSetting)
      ? (value as NightFeedSetting)
      : DEFAULT_NIGHT_FEED_SETTING;
  } catch {
    return DEFAULT_NIGHT_FEED_SETTING;
  }
}

export function storeNightFeedSetting(setting: NightFeedSetting) {
  try {
    window.localStorage.setItem(NIGHT_FEED_STORAGE_KEY, setting);
  } catch {
    // Storage unavailable: the preference lasts for this session only.
  }
}

/** The explicit choice and the dismissal, validated field by field (storage is user-editable). */
export function loadNightFeedState(): NightFeedState {
  try {
    const raw = window.localStorage.getItem(NIGHT_FEED_STATE_STORAGE_KEY);
    if (!raw) return EMPTY_NIGHT_FEED_STATE;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return EMPTY_NIGHT_FEED_STATE;
    const { override, dismissedKey } = parsed as Record<string, unknown>;
    const o = override as { on?: unknown; key?: unknown } | null | undefined;
    return {
      override:
        o && typeof o.on === 'boolean' && typeof o.key === 'string'
          ? { on: o.on, key: o.key }
          : null,
      dismissedKey: typeof dismissedKey === 'string' ? dismissedKey : null,
    };
  } catch {
    return EMPTY_NIGHT_FEED_STATE;
  }
}

export function storeNightFeedState(state: NightFeedState) {
  try {
    window.localStorage.setItem(NIGHT_FEED_STATE_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage unavailable: the choice lasts for this session only.
  }
}
