const KEY = 'baby-routine.selected-baby';

export function readSelectedBabyId(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function writeSelectedBabyId(id: string): void {
  try {
    window.localStorage.setItem(KEY, id);
  } catch {
    // Storage unavailable: the selection just lasts for this session.
  }
}

/** Forgets the saved selection, whatever it points at (sign-out, account switch). */
export function forgetSelectedBaby(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // Storage unavailable: nothing was saved anyway.
  }
}

/** Forgets the saved selection, but only when it points at `id`. */
export function clearSelectedBabyId(id: string): void {
  try {
    if (window.localStorage.getItem(KEY) === id) window.localStorage.removeItem(KEY);
  } catch {
    // Storage unavailable: nothing was saved anyway.
  }
}
