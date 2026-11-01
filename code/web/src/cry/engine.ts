/**
 * CryEngine: the cry monitor's facade (docs/design/35-cry-engine.md). Wires capture -> classifier -> trigger and
 * exposes a small state machine (idle | loading | listening | error), the live smoothed score for a level meter, a
 * stall watchdog and the cry_started / cry_ended events. Foreground monitor mode only: it listens while its page
 * runs and stops on any capture loss. No audio leaves capture and classifier; only scores and times reach here.
 *
 * Every dependency is injectable (AudioSource, Classifier, scheduler), so tests run without a browser audio stack.
 */
import type { AudioFrame, AudioSource, CaptureInfo } from './capture';
import type { Classifier } from './classifier';
import type { LoadedInfo } from './classifierCore';
import { errorCodeOf, type CryEngineErrorCode } from './errors';
import { cryTriggerConfig, type CrySensitivity } from './sensitivity';
import { CryTrigger, type CryTriggerConfig, type CryTriggerEvent } from './trigger';

export type CryEngineState = 'idle' | 'loading' | 'listening' | 'error';

/** No frame for longer than this while listening: `stalled` (once, until frames come back: `resumed`). */
export const STALL_AFTER_MS = 5000;
const WATCHDOG_EVERY_MS = 1000;

export interface CryEngineEventMap {
  state: { state: CryEngineState; error: CryEngineErrorCode | null };
  cry_started: Extract<CryTriggerEvent, { type: 'cry_started' }>;
  cry_ended: Extract<CryTriggerEvent, { type: 'cry_ended' }>;
  stalled: { at: number; lastFrameAt: number | null };
  resumed: { at: number };
  /** One classified frame: for a level meter (`smoothed`) and diagnostics. */
  score: { t: number; score: number; smoothed: number; inferenceMs: number };
}
export type CryEngineEventType = keyof CryEngineEventMap;

/** Clock and timer; epoch milliseconds, the same domain as the frame times. */
export interface Scheduler {
  now(): number;
  every(ms: number, run: () => void): () => void;
}

export const systemScheduler: Scheduler = {
  now: () => Date.now(),
  every: (ms, run) => {
    const id = setInterval(run, ms);
    return () => clearInterval(id);
  },
};

export interface CryEngineDeps {
  createSource: () => AudioSource | Promise<AudioSource>;
  createClassifier: () => Classifier | Promise<Classifier>;
  scheduler?: Scheduler;
}

export interface CryEngineStartOptions {
  sensitivity?: CrySensitivity;
  /** Rule overrides for tests and the bench; the monitor only picks a sensitivity. */
  trigger?: Partial<CryTriggerConfig>;
}

export interface CryEngineStats {
  frames: number;
  /** Frames missing from the sequence (dropped by capture while the classifier was behind). */
  missedFrames: number;
  loadMs: number | null;
  lastInferenceMs: number | null;
  meanInferenceMs: number | null;
  maxInferenceMs: number | null;
}

type Listener<K extends CryEngineEventType> = (payload: CryEngineEventMap[K]) => void;

export class CryEngine {
  private readonly deps: CryEngineDeps;
  private readonly scheduler: Scheduler;
  private readonly listeners = new Map<CryEngineEventType, Set<Listener<CryEngineEventType>>>();
  private currentState: CryEngineState = 'idle';
  private currentError: CryEngineErrorCode | null = null;
  /** Bumped by every start/stop: late results of an older run are ignored. */
  private generation = 0;
  private source: AudioSource | null = null;
  private classifier: Classifier | null = null;
  private trigger: CryTrigger | null = null;
  private stopWatchdog: (() => void) | null = null;
  private queue: AudioFrame[] = [];
  private pumping = false;
  private lastFrameWallAt: number | null = null;
  private listeningSince = 0;
  private stalled = false;
  private lastIndex: number | null = null;
  private info: CaptureInfo | null = null;
  private loaded: LoadedInfo | null = null;
  private counters = {
    frames: 0,
    missed: 0,
    inferenceTotal: 0,
    last: null as number | null,
    max: 0,
  };

  constructor(deps: CryEngineDeps) {
    this.deps = deps;
    this.scheduler = deps.scheduler ?? systemScheduler;
  }

  get state(): CryEngineState {
    return this.currentState;
  }

  get error(): CryEngineErrorCode | null {
    return this.currentError;
  }

  /** The current smoothed score (0 before the first frame): drives a level meter, never shown as a number. */
  get level(): number {
    return this.trigger?.smoothedScore ?? 0;
  }

  get crying(): boolean {
    return this.trigger?.crying ?? false;
  }

  /** Wall-clock time the last frame was classified, or null. */
  get lastFrameAt(): number | null {
    return this.lastFrameWallAt;
  }

  /** Processing the browser left on (warn) or does not report (unknown), once listening. */
  get capture(): CaptureInfo | null {
    return this.info;
  }

  get model(): LoadedInfo | null {
    return this.loaded;
  }

  get stats(): CryEngineStats {
    const { frames, missed, inferenceTotal, last, max } = this.counters;
    return {
      frames,
      missedFrames: missed,
      loadMs: this.loaded?.loadMs ?? null,
      lastInferenceMs: last,
      meanInferenceMs: frames > 0 ? inferenceTotal / frames : null,
      maxInferenceMs: frames > 0 ? max : null,
    };
  }

  on<K extends CryEngineEventType>(type: K, listener: Listener<K>): () => void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(listener as Listener<CryEngineEventType>);
    return () => set.delete(listener as Listener<CryEngineEventType>);
  }

  /**
   * Loads the classifier (model checks first: a missing model fails before the microphone prompt), then opens the
   * microphone. Resolves with the resulting state ('listening' or 'error'; 'idle' when stopped meanwhile).
   */
  async start(options: CryEngineStartOptions = {}): Promise<CryEngineState> {
    if (this.currentState === 'loading' || this.currentState === 'listening')
      return this.currentState;
    const trigger = new CryTrigger(cryTriggerConfig(options.sensitivity, options.trigger));
    const gen = ++this.generation;
    this.reset();
    this.trigger = trigger;
    this.setState('loading', null);
    const current = () => gen === this.generation;
    try {
      const classifier = await this.deps.createClassifier();
      if (!current()) return this.abandon(() => classifier.dispose());
      this.classifier = classifier;
      this.loaded = await classifier.load();
      if (!current()) return this.currentState;
      const source = await this.deps.createSource();
      if (!current()) return this.abandon(() => source.stop());
      this.source = source;
      this.listeningSince = this.scheduler.now();
      const info = await source.start({
        frame: (frame) => current() && this.enqueue(frame),
        lost: (code) => current() && this.fail(code),
      });
      if (!current()) return this.currentState;
      this.info = info;
      this.listeningSince = this.scheduler.now();
      this.stopWatchdog = this.scheduler.every(WATCHDOG_EVERY_MS, () => current() && this.watch());
      this.setState('listening', null);
    } catch (error) {
      if (current()) this.fail(errorCodeOf(error));
    }
    return this.currentState;
  }

  /**
   * Changes the sensitivity while loading or listening, without restarting (the microphone and a running cry
   * stay): the trigger's threshold moves from the next window on. The next `start` always takes its own
   * sensitivity.
   */
  setSensitivity(sensitivity: CrySensitivity): void {
    this.trigger?.setThreshold(cryTriggerConfig(sensitivity).threshold);
  }

  /** Stops listening and frees everything; a running cry ends now (`cry_ended`, reason stream_end). */
  stop(): void {
    if (this.currentState === 'idle') return;
    this.teardown();
    this.setState('idle', null);
  }

  private fail(code: CryEngineErrorCode): void {
    this.teardown();
    this.setState('error', code);
  }

  private teardown(): void {
    this.generation++;
    const ended = this.trigger?.finish() ?? [];
    this.stopWatchdog?.();
    this.stopWatchdog = null;
    this.source?.stop();
    this.source = null;
    this.classifier?.dispose();
    this.classifier = null;
    this.queue = [];
    this.emitTrigger(ended);
  }

  private abandon(cleanup: () => void): CryEngineState {
    cleanup();
    return this.currentState;
  }

  private reset(): void {
    this.queue = [];
    this.lastFrameWallAt = null;
    this.stalled = false;
    this.lastIndex = null;
    this.info = null;
    this.loaded = null;
    this.counters = { frames: 0, missed: 0, inferenceTotal: 0, last: null, max: 0 };
  }

  private enqueue(frame: AudioFrame): void {
    this.queue.push(frame);
    if (!this.pumping) void this.pump(this.generation);
  }

  private async pump(gen: number): Promise<void> {
    this.pumping = true;
    try {
      while (gen === this.generation && this.queue.length > 0) {
        const frame = this.queue.shift() as AudioFrame;
        const classifier = this.classifier;
        if (!classifier) return;
        let result;
        try {
          result = await classifier.classify(frame.samples);
        } catch (error) {
          if (gen === this.generation) this.fail(errorCodeOf(error));
          return;
        }
        if (gen !== this.generation) return;
        this.source?.release(result.samples);
        this.onScore(frame, result.score, result.inferenceMs);
      }
    } finally {
      this.pumping = false;
    }
  }

  private onScore(frame: AudioFrame, score: number, inferenceMs: number): void {
    const now = this.scheduler.now();
    this.lastFrameWallAt = now;
    if (this.lastIndex !== null && frame.index > this.lastIndex + 1) {
      this.counters.missed += frame.index - this.lastIndex - 1;
    }
    this.lastIndex = frame.index;
    const c = this.counters;
    c.frames++;
    c.inferenceTotal += inferenceMs;
    c.last = inferenceMs;
    c.max = Math.max(c.max, inferenceMs);
    if (this.stalled) {
      this.stalled = false;
      this.emit('resumed', { at: now });
    }
    const trigger = this.trigger as CryTrigger;
    const events = trigger.push({ t: frame.t, score });
    this.emit('score', {
      t: frame.t,
      score,
      smoothed: trigger.smoothedScore ?? score,
      inferenceMs,
    });
    this.emitTrigger(events);
  }

  private watch(): void {
    const now = this.scheduler.now();
    if (this.trigger) this.emitTrigger(this.trigger.tick(now));
    const since = this.lastFrameWallAt ?? this.listeningSince;
    if (!this.stalled && now - since > STALL_AFTER_MS) {
      this.stalled = true;
      this.emit('stalled', { at: now, lastFrameAt: this.lastFrameWallAt });
    }
  }

  private emitTrigger(events: CryTriggerEvent[]): void {
    for (const event of events) {
      if (event.type === 'cry_started') this.emit('cry_started', event);
      else this.emit('cry_ended', event);
    }
  }

  private setState(state: CryEngineState, error: CryEngineErrorCode | null): void {
    this.currentState = state;
    this.currentError = error;
    this.emit('state', { state, error });
  }

  private emit<K extends CryEngineEventType>(type: K, payload: CryEngineEventMap[K]): void {
    for (const listener of this.listeners.get(type) ?? []) {
      try {
        (listener as Listener<K>)(payload);
      } catch (error) {
        // A listener's bug must not stop the engine.
        console.error('cry engine listener failed', error);
      }
    }
  }
}
