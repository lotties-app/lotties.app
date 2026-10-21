/*
 * When this device last showed a baby's Now screen (the hand-over card lists what others logged
 * since then). Per baby, in localStorage; cleared with the account's other device state.
 */

const PREFIX = 'baby-routine.last-seen.';
const keyFor = (babyId: string) => `${PREFIX}${babyId}`;

/** UTC ISO time, or `null` when this device never showed the baby (or storage is unavailable). */
export function readLastSeenAt(babyId: string): string | null {
  try {
    const raw = window.localStorage.getItem(keyFor(babyId));
    return raw && Number.isFinite(Date.parse(raw)) ? raw : null;
  } catch {
    return null;
  }
}

export function writeLastSeenAt(babyId: string, at: string): void {
  try {
    window.localStorage.setItem(keyFor(babyId), at);
  } catch {
    // Storage unavailable: the card just shows again next time.
  }
}

export function clearLastSeen(babyId: string): void {
  try {
    window.localStorage.removeItem(keyFor(babyId));
  } catch {
    // Storage unavailable: nothing to clear.
  }
}

export function clearAllLastSeen(): void {
  try {
    const storage = window.localStorage;
    const keys = Array.from({ length: storage.length }, (_, i) => storage.key(i));
    for (const key of keys) if (key?.startsWith(PREFIX)) storage.removeItem(key);
  } catch {
    // Storage unavailable: nothing to clear.
  }
}
