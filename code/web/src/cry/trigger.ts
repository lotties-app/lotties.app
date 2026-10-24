/**
 * The sustained-cry trigger: a streaming, deterministic port of `ml/cry_detector/cry_detector/trigger.py`
 * (docs/design/31-cry-detector-spike.md section 3, docs/design/35-cry-engine.md). No timers and no I/O: the
 * caller pushes one score per YAMNet window (`push`) and may call `tick(now)` to close a cry when frames stop.
 *
 * Per window: the smoothed score (causal mean of the last `smoothing` windows, computed with the same running
 * cumulative sum as numpy so the two agree to the bit) is "active" when >= `threshold`. A cry starts when at least
 * `minSeconds` of the last `windowSeconds` are active; the decision comes at the end of that window and the event's
 * `at` is the start of the first active window inside it (the real start, not the detection time). It ends after
 * `quietSeconds` without an active window: `at` is the end of the last active window. The shared vectors
 * (`cryTriggerVectors.json`, written by `python -m cry_detector.make_vectors`) pin the equality with Python.
 */

/** YAMNet through MediaPipe classifies non-overlapping windows of 15600 samples at 16 kHz: 0.975 s. */
export const YAMNET_HOP_MS = 975;

export interface CryTriggerConfig {
  /** Smoothed score at or above which a window is active (inclusive). */
  threshold: number;
  /** Active seconds needed inside the sliding window to start a cry (the spike's N). */
  minSeconds: number;
  /** Length of the sliding window (the spike's M). */
  windowSeconds: number;
  /** Seconds without an active window that end a cry (the spike's Q); at least `windowSeconds`. */
  quietSeconds: number;
  /** Windows in the causal moving average (1 = raw scores). */
  smoothing: number;
  /** Window hop; defaults to YAMNet's 975 ms. */
  hopMs?: number;
}

/** The spike's standard rule (docs/design/31 section 0): mean of 3, >= 0.02, 20 s of 60 s, 3 min quiet. */
export const DEFAULT_CRY_TRIGGER: Readonly<CryTriggerConfig> = Object.freeze({
  threshold: 0.02,
  minSeconds: 20,
  windowSeconds: 60,
  quietSeconds: 180,
  smoothing: 3,
});

/** One classified window: `t` = epoch ms of its first sample, `score` = the "Baby cry, infant cry" score. */
export interface ScoreFrame {
  t: number;
  score: number;
}

export type CryTriggerEvent =
  | {
      type: 'cry_started';
      /** Start of the first active window of the sustained run (the fussy event's start). */
      at: number;
      /** End of the window that completed the rule (when the device knew). */
      detectedAt: number;
    }
  | {
      type: 'cry_ended';
      /** End of the last active window (the fussy event's end). */
      at: number;
      startedAt: number;
      /** When the end became known: after the quiet period, or the end of the stream. */
      closedAt: number;
      reason: 'quiet' | 'stream_end';
    };

export interface TriggerWindows {
  /** Windows in the sliding window (M). */
  window: number;
  /** Active windows needed (N). */
  need: number;
  /** Quiet windows that end a cry (Q). */
  quiet: number;
}

/** Python's round(): half to even (only matters on an exact .5). */
function roundHalfEven(x: number): number {
  const r = Math.round(x);
  return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
}

/** Same arithmetic as `windows_for` in trigger.py; throws a RangeError on an impossible rule. */
export function triggerWindows(config: CryTriggerConfig): TriggerWindows {
  const hop = (config.hopMs ?? YAMNET_HOP_MS) / 1000;
  if (!(hop > 0) || !(config.smoothing >= 1) || !Number.isFinite(config.threshold)) {
    throw new RangeError('invalid cry trigger config');
  }
  const window = Math.max(1, roundHalfEven(config.windowSeconds / hop));
  const need = Math.max(1, Math.ceil(config.minSeconds / hop - 1e-9));
  const quiet = Math.max(1, Math.ceil(config.quietSeconds / hop - 1e-9));
  if (need > window) throw new RangeError('minSeconds must not exceed windowSeconds');
  if (quiet < window) {
    throw new RangeError('quietSeconds must be at least windowSeconds (a new cry counts fresh windows)');
  }
  return { window, need, quiet };
}

export class CryTrigger {
  readonly config: Readonly<CryTriggerConfig>;
  readonly windows: Readonly<TriggerWindows>;
  private readonly hopMs: number;
  private readonly smoothing: number;
  // Sliding window of the last M windows: active flags and start times.
  private readonly active: Uint8Array;
  private readonly times: Float64Array;
  private activeCount = 0;
  // Running cumulative sum (as numpy's cumsum) and its last `smoothing` + 1 values.
  private readonly cumRing: Float64Array;
  private cum = 0;
  /** Windows processed so far (index of the next one). */
  private n = 0;
  private lastT: number | null = null;
  private smoothed: number | null = null;
  // The running cry, if any.
  private startedAt: number | null = null;
  private lastActiveT = 0;
  private quietRun = 0;
  /** Frames whose window ends at or before this were already decided (a cry closed by `tick`). */
  private decidedUntil = -Infinity;

  constructor(config: CryTriggerConfig = DEFAULT_CRY_TRIGGER) {
    this.config = Object.freeze({ ...config });
    this.windows = Object.freeze(triggerWindows(config));
    this.hopMs = config.hopMs ?? YAMNET_HOP_MS;
    this.smoothing = Math.max(1, Math.floor(config.smoothing));
    this.active = new Uint8Array(this.windows.window);
    this.times = new Float64Array(this.windows.window);
    this.cumRing = new Float64Array(this.smoothing + 1);
  }

  /** The last smoothed score (for a level meter), or null before the first window. */
  get smoothedScore(): number | null {
    return this.smoothed;
  }

  get crying(): boolean {
    return this.startedAt !== null;
  }

  /** Start time of the last window pushed, or null. */
  get lastFrameT(): number | null {
    return this.lastT;
  }

  /**
   * One classified window. Windows must come in order, one hop apart: a duplicate or older frame is ignored, and a
   * gap (lost frames) counts as quiet windows with score 0.
   */
  push(frame: ScoreFrame): CryTriggerEvent[] {
    const events: CryTriggerEvent[] = [];
    if (frame.t + this.hopMs <= this.decidedUntil) return events;
    if (this.lastT !== null) {
      if (frame.t < this.lastT + this.hopMs / 2) return events;
      const missing = Math.round((frame.t - this.lastT) / this.hopMs) - 1;
      // After Q + M + smoothing quiet windows the state no longer changes: skip the rest of a long gap.
      const replay = Math.min(missing, this.windows.quiet + this.windows.window + this.smoothing);
      for (let k = 1; k <= replay; k++) this.step(this.lastT + this.hopMs, 0, events);
      if (missing > replay) this.lastT = frame.t - this.hopMs;
    }
    this.step(frame.t, frame.score, events);
    return events;
  }

  /**
   * Closes a running cry when its quiet period has passed by `now` and the frame that would have closed it is a
   * whole hop overdue (frames stopped). With frames flowing, `push` closes it first, at the same `at`/`closedAt`.
   */
  tick(now: number): CryTriggerEvent[] {
    if (this.startedAt === null) return [];
    const closedAt = this.lastActiveT + (this.windows.quiet + 1) * this.hopMs;
    if (now < closedAt + this.hopMs) return [];
    const event = this.close(closedAt, 'quiet');
    this.decidedUntil = closedAt;
    return [event];
  }

  /** End of the stream (monitor stopped): closes a running cry at the end of the last window pushed. */
  finish(): CryTriggerEvent[] {
    if (this.startedAt === null || this.lastT === null) return [];
    return [this.close(this.lastT + this.hopMs, 'stream_end')];
  }

  private step(t: number, score: number, events: CryTriggerEvent[]): void {
    const i = this.n;
    const k = this.smoothing;
    // Smoothing: (c[i+1] - c[lo]) / (i + 1 - lo), lo = max(0, i - k + 1), c = [0, cumsum(scores)].
    let value = score;
    if (k > 1) {
      this.cum += score;
      this.cumRing[(i + 1) % (k + 1)] = this.cum;
      const lo = Math.max(0, i - k + 1);
      value = (this.cum - this.cumRing[lo % (k + 1)]) / (i + 1 - lo);
    }
    this.smoothed = value;
    const isActive = value >= this.config.threshold ? 1 : 0;
    const slot = i % this.windows.window;
    this.activeCount += isActive - this.active[slot];
    this.active[slot] = isActive;
    this.times[slot] = t;
    this.n = i + 1;
    this.lastT = t;

    if (this.startedAt !== null) {
      if (isActive) {
        this.lastActiveT = t;
        this.quietRun = 0;
      } else if (++this.quietRun >= this.windows.quiet) {
        events.push(this.close(this.lastActiveT + (this.windows.quiet + 1) * this.hopMs, 'quiet'));
      }
      return;
    }
    if (this.activeCount >= this.windows.need) {
      const first = this.firstActiveSlot();
      this.startedAt = this.times[first];
      this.lastActiveT = t;
      this.quietRun = 0;
      events.push({ type: 'cry_started', at: this.startedAt, detectedAt: t + this.hopMs });
    }
  }

  /** Oldest active window still inside the sliding window. */
  private firstActiveSlot(): number {
    const m = this.windows.window;
    const oldest = Math.max(0, this.n - m);
    for (let i = oldest; i < this.n; i++) {
      if (this.active[i % m]) return i % m;
    }
    return (this.n - 1) % m;
  }

  private close(closedAt: number, reason: 'quiet' | 'stream_end'): CryTriggerEvent {
    const event: CryTriggerEvent = {
      type: 'cry_ended',
      at: this.lastActiveT + this.hopMs,
      startedAt: this.startedAt as number,
      closedAt,
      reason,
    };
    // A new cry counts only windows after this one (trigger.py: pos = last + Q + 1).
    this.startedAt = null;
    this.quietRun = 0;
    this.active.fill(0);
    this.activeCount = 0;
    return event;
  }
}
