/*
 * What this device remembers about its own push opt-in (per account: cleared with the account's
 * other localStorage entries in session/deviceState.ts). The record exists only after the user
 * turned notifications on here; the start-up reconcile never registers a device without it, so a
 * device removed from another device stays removed.
 */

export interface PushDeviceRecord {
  /** The browser subscription endpoint the user opted in with. */
  endpoint: string;
  /** The server id of this device; `null` until the subscribe call succeeded. */
  id: string | null;
}

/** Storage port, so the reconcile is tested without localStorage. */
export interface PushDeviceRecordStore {
  read: () => PushDeviceRecord | null;
  write: (record: PushDeviceRecord) => void;
  clear: () => void;
}

const KEY = 'baby-routine.push-device';

function parse(raw: string | null): PushDeviceRecord | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) return null;
    const { endpoint, id } = value as Record<string, unknown>;
    if (typeof endpoint !== 'string' || !endpoint) return null;
    return { endpoint, id: typeof id === 'string' && id ? id : null };
  } catch {
    return null;
  }
}

/** The record in localStorage; storage errors read as "not opted in" and writes are dropped. */
export const localPushDeviceRecord: PushDeviceRecordStore = {
  read: () => {
    try {
      return parse(window.localStorage.getItem(KEY));
    } catch {
      return null;
    }
  },
  write: (record) => {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(record));
    } catch {
      // Storage unavailable: the next start treats the device as not opted in.
    }
  },
  clear: () => {
    try {
      window.localStorage.removeItem(KEY);
    } catch {
      // Storage unavailable: nothing was saved.
    }
  },
};

/** An in-memory store (tests and the developer preview). */
export function memoryPushDeviceRecord(
  initial: PushDeviceRecord | null = null,
): PushDeviceRecordStore & { current: PushDeviceRecord | null } {
  const store = {
    current: initial,
    read: () => store.current,
    write: (record: PushDeviceRecord) => {
      store.current = record;
    },
    clear: () => {
      store.current = null;
    },
  };
  return store;
}
