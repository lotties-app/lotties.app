/*
 * The "Not today" / "Not now" choices of the Now suggestions (belly pain and fussy patterns, the
 * overtired heads-up, the diaper cards): one value per baby in localStorage, under a prefix of its own. Entries are
 * per account (cleared with the account's other device state, session/deviceState.ts). Reads
 * accept only values in the expected shape; storage errors never break the screen.
 */

/** A local date (`yyyy-mm-dd`): one choice per usual window. */
export const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** A UTC ISO instant: one choice per awake stretch (the instant it started) or diaper anchor. */
export const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

export interface DismissalStore {
  /** The value chosen for this baby, or `null`. */
  read(babyId: string): string | null;
  write(babyId: string, value: string): void;
  /** Removes the entries of every baby (sign-out, leaving the account). */
  clearAll(): void;
}

export function dismissalStore(prefix: string, shape: RegExp): DismissalStore {
  const keyFor = (babyId: string) => `${prefix}${babyId}`;
  return {
    read(babyId) {
      try {
        const raw = window.localStorage.getItem(keyFor(babyId));
        return raw && shape.test(raw) ? raw : null;
      } catch {
        return null;
      }
    },
    write(babyId, value) {
      try {
        window.localStorage.setItem(keyFor(babyId), value);
      } catch {
        // Storage unavailable: the card hides until the screen is opened again.
      }
    },
    clearAll() {
      try {
        const storage = window.localStorage;
        const keys = Array.from({ length: storage.length }, (_, i) => storage.key(i));
        for (const key of keys) if (key?.startsWith(prefix)) storage.removeItem(key);
      } catch {
        // Storage unavailable: nothing to clear.
      }
    },
  };
}

/** "Not today" of the fussy pattern suggestion: the local date of the window. */
export const fussyDismissal = dismissalStore('baby-routine.fussy-pattern-dismissed.', LOCAL_DATE);

/** "Not now" of the overtired heads-up: the start of the awake stretch (UTC ISO). */
export const overtiredDismissal = dismissalStore('baby-routine.overtired-dismissed.', ISO_INSTANT);

/** "Not now" of the wet diaper card: its anchor, the latest wet diaper (UTC ISO). */
export const diaperWetDismissal = dismissalStore('baby-routine.diaper-wet-dismissed.', ISO_INSTANT);

/** "Not now" of the dirty diaper card: its anchor, the feed end or the latest dirty diaper (UTC ISO). */
export const diaperDirtyDismissal = dismissalStore(
  'baby-routine.diaper-dirty-dismissed.',
  ISO_INSTANT,
);
