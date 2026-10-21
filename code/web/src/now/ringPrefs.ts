export type NowView = 'ruler' | 'ring';

const KEY = 'baby-routine.now-view';

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
