export type NowView = 'ruler' | 'ring';

const KEY = 'baby-routine.now-view';
const OPEN_KEY = 'baby-routine.now-ring-open';

/** Below these the ring starts folded: the actions come first on a short or narrow screen. */
export const RING_OPEN_MIN_HEIGHT = 740;
export const RING_OPEN_MIN_WIDTH = 400;

/** The view of the state card the parent chose; the ruler by default. */
export function readNowView(): NowView {
  try {
    return window.localStorage.getItem(KEY) === 'ring' ? 'ring' : 'ruler';
  } catch {
    return 'ruler';
  }
}

export function writeNowView(view: NowView): void {
  try {
    window.localStorage.setItem(KEY, view);
  } catch {
    // Storage unavailable: the choice lasts for this session only.
  }
}

/** Open unless the screen is shorter than 740 px or narrower than 400 px. */
export function defaultRingOpen(): boolean {
  if (typeof window === 'undefined') return true;
  return window.innerHeight >= RING_OPEN_MIN_HEIGHT && window.innerWidth >= RING_OPEN_MIN_WIDTH;
}

/** Whether the day ring (or ruler) region of the state card is open: per device, remembered. */
export function readRingOpen(): boolean {
  try {
    const stored = window.localStorage.getItem(OPEN_KEY);
    if (stored === 'open') return true;
    if (stored === 'closed') return false;
  } catch {
    // Storage unavailable: fall back to the size of the screen.
  }
  return defaultRingOpen();
}

export function writeRingOpen(open: boolean): void {
  try {
    window.localStorage.setItem(OPEN_KEY, open ? 'open' : 'closed');
  } catch {
    // Storage unavailable: the choice lasts while the screen is open.
  }
}
