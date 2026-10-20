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
