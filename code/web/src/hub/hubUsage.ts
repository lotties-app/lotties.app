import { useSyncExternalStore } from 'react';
import {
  canBeShortcut,
  DEFAULT_SHORTCUT_ORDER,
  HUB_ENTRY_IDS,
  SHORTCUT_COUNT,
  type HubEntry,
  type HubEntryId,
} from './hubEntries';

/*
 * What the Hub remembers about the person on this device: how often each entry was opened (the
 * top shortcuts follow it) and, once she customizes, the shortcuts she picked. A per-device UI
 * preference like the theme, so it lives in localStorage, not in the synced store; every access is
 * guarded because storage can be blocked or full.
 */

const STORAGE_KEY = 'lotties.hub.v1';

export interface HubPrefs {
  counts: Partial<Record<HubEntryId, number>>;
  /** The shortcuts the person chose, in order; `null` means "pick by usage". */
  pinned: HubEntryId[] | null;
}

const EMPTY: HubPrefs = { counts: {}, pinned: null };

const isEntryId = (value: unknown): value is HubEntryId =>
  typeof value === 'string' && (HUB_ENTRY_IDS as readonly string[]).includes(value);

/** Reads stored prefs, tolerating anything that is not ours (older shapes, hand edits). */
export function parsePrefs(raw: string | null): HubPrefs {
  if (!raw) return EMPTY;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) return EMPTY;
    const record = value as Record<string, unknown>;
    const counts: HubPrefs['counts'] = {};
    if (typeof record.counts === 'object' && record.counts !== null) {
      for (const [key, count] of Object.entries(record.counts)) {
        if (isEntryId(key) && typeof count === 'number' && Number.isFinite(count) && count > 0) {
          counts[key] = Math.floor(count);
        }
      }
    }
    const pinned = Array.isArray(record.pinned)
      ? record.pinned.filter(isEntryId).slice(0, SHORTCUT_COUNT)
      : null;
    return { counts, pinned };
  } catch {
    return EMPTY;
  }
}

let current: HubPrefs | undefined;
const listeners = new Set<() => void>();

function load(): HubPrefs {
  if (current) return current;
  try {
    current = parsePrefs(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    current = EMPTY;
  }
  return current;
}

function save(next: HubPrefs) {
  current = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage is blocked or full: the choice lives for this session only.
  }
  for (const listener of listeners) listener();
}

/** Counts one opening of an entry. */
export function recordHubUse(id: HubEntryId) {
  const prefs = load();
  save({ ...prefs, counts: { ...prefs.counts, [id]: (prefs.counts[id] ?? 0) + 1 } });
}

/** Sets the shortcuts by hand (`null` goes back to picking by usage). */
export function setPinnedShortcuts(ids: HubEntryId[] | null) {
  save({ ...load(), pinned: ids === null ? null : ids.slice(0, SHORTCUT_COUNT) });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useHubPrefs(): HubPrefs {
  return useSyncExternalStore(subscribe, load, () => EMPTY);
}

/** Test seam: forget the in-memory copy so the next read goes to storage again. */
export function resetHubPrefs() {
  current = undefined;
  for (const listener of listeners) listener();
}

/**
 * The shortcuts to show: the person's own pick (kept to what she can still see), else the most
 * opened entries, ties and unused ones in the default order. Never more than `SHORTCUT_COUNT`.
 */
export function pickShortcuts(visible: readonly HubEntry[], prefs: HubPrefs): HubEntry[] {
  const eligible = visible.filter(canBeShortcut);
  if (prefs.pinned) {
    return prefs.pinned
      .map((id) => eligible.find((entry) => entry.id === id))
      .filter((entry): entry is HubEntry => entry !== undefined);
  }
  const rank = (id: HubEntryId) => {
    const index = DEFAULT_SHORTCUT_ORDER.indexOf(id);
    return index === -1 ? DEFAULT_SHORTCUT_ORDER.length : index;
  };
  return [...eligible]
    .sort(
      (a, b) => (prefs.counts[b.id] ?? 0) - (prefs.counts[a.id] ?? 0) || rank(a.id) - rank(b.id),
    )
    .slice(0, SHORTCUT_COUNT);
}
