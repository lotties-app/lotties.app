/*
 * Geometry of the day ruler (awake window + predicted nap window), pure and testable.
 */

const MINUTE_MS = 60_000;
/** The ruler spans at least this long, so a short awake time still leaves room for the window. */
const MIN_SPAN_MS = 2 * 60 * MINUTE_MS;
/** Room kept after the later of now and the window end. */
const TAIL_MS = 30 * MINUTE_MS;

export interface RulerInput {
  /** When the baby woke up (UTC ISO). */
  since: string;
  now: Date;
  /** The predicted nap window, when there is one (UTC ISO). */
  window?: { earliest: string; latest: string };
  /**
   * The end of the last estimate drawn after the window (projected naps, the bedtime window), in
   * ms: the ruler reaches it too.
   */
  until?: number;
}

const clampPercent = (value: number) => Math.min(100, Math.max(0, value));

/** Positions (percent along the bar) and end of the ruler; exported for tests. */
export function rulerGeometry({ since, now, window, until }: RulerInput) {
  const start = Date.parse(since);
  const nowMs = Math.max(start, now.getTime());
  const windowEnd = window ? Date.parse(window.latest) : nowMs;
  const last = Math.max(nowMs, windowEnd, until ?? nowMs);
  const end = Math.max(start + MIN_SPAN_MS, last + TAIL_MS);
  const span = end - start;
  const at = (ms: number) => clampPercent(((ms - start) / span) * 100);
  return {
    start,
    end,
    /** Percent along the bar of an instant (ms), clamped to the bar. */
    at,
    nowPercent: at(nowMs),
    band: window
      ? {
          left: at(Date.parse(window.earliest)),
          right: at(Date.parse(window.latest)),
        }
      : null,
  };
}
