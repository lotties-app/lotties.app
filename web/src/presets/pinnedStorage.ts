import { DEFAULT_PINNED } from './catalogue';
import { MAX_PINNED } from './types';

const KEY_PREFIX = 'baby-routine.pinned-presets.';

/** The pinned preset ids of a baby, in order; the defaults when nothing valid is stored. */
export function loadPinned(babyId: string): string[] {
  try {
    const raw = window.localStorage.getItem(KEY_PREFIX + babyId);
    if (raw === null) return [...DEFAULT_PINNED];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [...DEFAULT_PINNED];
    return normalize(parsed);
  } catch {
    return [...DEFAULT_PINNED];
  }
}

export function storePinned(babyId: string, ids: readonly string[]): void {
  try {
    window.localStorage.setItem(KEY_PREFIX + babyId, JSON.stringify(normalize(ids)));
  } catch {
    // Storage unavailable: the choice lasts for this session only.
  }
}

function normalize(values: readonly unknown[]): string[] {
  const ids = values.filter((v): v is string => typeof v === 'string' && v.length > 0);
  return [...new Set(ids)].slice(0, MAX_PINNED);
}

/** Forgets the pinned presets of one baby (the baby left this device). */
export function clearPinned(babyId: string): void {
  try {
    window.localStorage.removeItem(KEY_PREFIX + babyId);
  } catch {
    // Storage unavailable: nothing to clear.
  }
}

/** Forgets every baby's pinned presets (sign-out, account switch). */
export function clearAllPinned(): void {
  try {
    const storage = window.localStorage;
    const keys = Array.from({ length: storage.length }, (_, i) => storage.key(i));
    for (const key of keys) if (key?.startsWith(KEY_PREFIX)) storage.removeItem(key);
  } catch {
    // Storage unavailable: nothing to clear.
  }
}
