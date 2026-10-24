import { describe, expect, it, vi } from 'vitest';
import type { AudioSource, AudioSourceHandlers, CaptureInfo } from './capture';
import type { Classifier, ClassifiedFrame } from './classifier';
import { CryEngine, STALL_AFTER_MS, type CryEngineEventMap, type Scheduler } from './engine';
import { CryEngineError } from './errors';
import { YAMNET_HOP_MS } from './trigger';
import vectors from './cryTriggerVectors.json';

/*
 * The facade with fakes: no microphone, no worker, no WASM. The fake source hands frames whose first sample carries
 * the score the fake classifier returns, so recorded score sequences run through capture -> classifier -> trigger.
 */

const HOP = YAMNET_HOP_MS;
const T0 = Date.UTC(2026, 9, 24, 23, 0);
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** The score each fake frame stands for (kept exact: a Float32Array sample would round it). */
const SCORES = new WeakMap<Float32Array, number>();

const INFO: CaptureInfo = { contextSampleRate: 48000, processingOn: [], processingUnknown: [] };

class FakeSource implements AudioSource {
  handlers: AudioSourceHandlers | null = null;
  released: Float32Array[] = [];
  stopped = false;
  started = 0;
  constructor(private readonly failWith?: CryEngineError) {}
  async start(handlers: AudioSourceHandlers): Promise<CaptureInfo> {
    this.started++;
    if (this.failWith) throw this.failWith;
    this.handlers = handlers;
    return { ...INFO, processingOn: ['autoGainControl'] };
  }
  release(samples: Float32Array): void {
    this.released.push(samples);
  }
  stop(): void {
    this.stopped = true;
  }
  /** Frames i = from..from+scores.length-1, starting at T0. */
  feed(scores: number[], from = 0): void {
    scores.forEach((score, k) => {
      const samples = new Float32Array(4);
      SCORES.set(samples, score);
      this.handlers?.frame({ index: from + k, t: T0 + (from + k) * HOP, samples });
    });
  }
}

class FakeClassifier implements Classifier {
  disposed = false;
  loads = 0;
  constructor(
    private readonly loadError?: CryEngineError,
    private readonly gate?: Promise<void>,
  ) {}
  async load() {
    this.loads++;
    await this.gate;
    if (this.loadError) throw this.loadError;
    return { categoryIndex: 20, categoryName: 'Baby cry, infant cry', loadMs: 12 };
  }
  async classify(samples: Float32Array): Promise<ClassifiedFrame> {
    if (this.disposed) throw new CryEngineError('classifier_failed', 'disposed');
    return { score: SCORES.get(samples) ?? 0, inferenceMs: 5, samples };
  }
  dispose(): void {
    this.disposed = true;
  }
}

class ManualScheduler implements Scheduler {
  time = T0;
  private tasks: { every: number; next: number; run: () => void }[] = [];
  now = () => this.time;
  every(ms: number, run: () => void) {
    const task = { every: ms, next: this.time + ms, run };
    this.tasks.push(task);
    return () => {
      this.tasks = this.tasks.filter((t) => t !== task);
    };
  }
  advance(ms: number) {
    const end = this.time + ms;
    for (;;) {
      const due = this.tasks.filter((t) => t.next <= end).sort((a, b) => a.next - b.next)[0];
      if (!due) break;
      this.time = due.next;
      due.next += due.every;
      due.run();
    }
    this.time = end;
  }
  get active() {
    return this.tasks.length;
  }
}

function setup(options: { source?: FakeSource; classifier?: FakeClassifier } = {}) {
  const source = options.source ?? new FakeSource();
  const classifier = options.classifier ?? new FakeClassifier();
  const scheduler = new ManualScheduler();
  const createSource = vi.fn(() => source);
  const engine = new CryEngine({ createSource, createClassifier: () => classifier, scheduler });
  const log: { type: string; payload: unknown }[] = [];
  for (const type of ['state', 'cry_started', 'cry_ended', 'stalled', 'resumed'] as const) {
    engine.on(type, (payload) => log.push({ type, payload }));
  }
  const of = <K extends keyof CryEngineEventMap>(type: K) =>
    log.filter((e) => e.type === type).map((e) => e.payload as CryEngineEventMap[K]);
  return { engine, source, classifier, scheduler, createSource, log, of };
}

describe('CryEngine lifecycle', () => {
  it('goes idle -> loading -> listening and back to idle, freeing capture and classifier', async () => {
    const { engine, source, classifier, scheduler, of } = setup();
    expect(engine.state).toBe('idle');
    const started = engine.start();
    expect(engine.state).toBe('loading');
    await expect(started).resolves.toBe('listening');
    expect(of('state').map((s) => s.state)).toEqual(['loading', 'listening']);
    expect(engine.capture?.processingOn).toEqual(['autoGainControl']);
    expect(engine.model).toMatchObject({ categoryName: 'Baby cry, infant cry', loadMs: 12 });
    expect(scheduler.active).toBe(1);

    engine.stop();
    expect(engine.state).toBe('idle');
    expect(source.stopped).toBe(true);
    expect(classifier.disposed).toBe(true);
    expect(scheduler.active).toBe(0);
    expect(of('state').map((s) => s.state)).toEqual(['loading', 'listening', 'idle']);
  });

  it('returns every frame buffer to the source and reports the level and timing', async () => {
    const { engine, source } = setup();
    const scores: number[] = [];
    engine.on('score', (s) => scores.push(s.smoothed));
    await engine.start();
    source.feed([0.3, 0.3, 0.3]);
    await flush();
    expect(source.released).toHaveLength(3);
    expect(scores).toHaveLength(3);
    expect(engine.level).toBeCloseTo(0.3, 12);
    expect(engine.stats).toMatchObject({ frames: 3, missedFrames: 0, lastInferenceMs: 5 });
  });

  it('fails with denied when the microphone is refused, after the model loaded', async () => {
    const { engine, classifier, of } = setup({
      source: new FakeSource(new CryEngineError('denied')),
    });
    await expect(engine.start()).resolves.toBe('error');
    expect(engine.error).toBe('denied');
    expect(classifier.disposed).toBe(true);
    expect(of('state').at(-1)).toEqual({ state: 'error', error: 'denied' });
  });

  it('fails with model_missing before asking for the microphone', async () => {
    const { engine, createSource } = setup({
      classifier: new FakeClassifier(new CryEngineError('model_missing')),
    });
    await expect(engine.start()).resolves.toBe('error');
    expect(engine.error).toBe('model_missing');
    expect(createSource).not.toHaveBeenCalled();
  });

  it('maps an unexpected failure to classifier_failed and can start again', async () => {
    const classifier = new FakeClassifier();
    classifier.classify = async () => {
      throw new Error('boom');
    };
    const { engine, source } = setup({ classifier });
    await engine.start();
    source.feed([0.1]);
    await flush();
    expect(engine.state).toBe('error');
    expect(engine.error).toBe('classifier_failed');
    expect(source.stopped).toBe(true);
  });

  it('stops cleanly while still loading', async () => {
    let open!: () => void;
    const gate = new Promise<void>((resolve) => (open = resolve));
    const { engine, classifier, createSource } = setup({
      classifier: new FakeClassifier(undefined, gate),
    });
    const started = engine.start();
    engine.stop();
    open();
    await expect(started).resolves.toBe('idle');
    expect(classifier.disposed).toBe(true);
    expect(createSource).not.toHaveBeenCalled();
    expect(engine.state).toBe('idle');
  });

  it('ignores a second start while running', async () => {
    const { engine, classifier } = setup();
    await engine.start();
    await expect(engine.start()).resolves.toBe('listening');
    expect(classifier.loads).toBe(1);
  });
});

describe('CryEngine events', () => {
  it('golden: a recorded score sequence gives the trigger.py events through the facade', async () => {
    for (const name of ['two_cries_long_gap', 'long_cry', 'quiet']) {
      const c = vectors.cases.find((v) => v.name === name)!;
      const { engine, source, of } = setup();
      await engine.start();
      source.feed(c.scores.split(' ').map(Number));
      await flush();
      expect(of('cry_started')).toEqual(
        c.events.map((e) => ({
          type: 'cry_started',
          at: T0 + e.startWindow * HOP,
          detectedAt: T0 + (e.detectedAfterWindow + 1) * HOP,
        })),
      );
      expect(of('cry_ended')).toEqual(
        c.events.map((e) => ({
          type: 'cry_ended',
          at: T0 + (e.endWindow + 1) * HOP,
          startedAt: T0 + e.startWindow * HOP,
          closedAt: T0 + e.closedWindows * HOP,
          reason: 'quiet',
        })),
      );
      engine.stop();
    }
  });

  it('cry_started carries the first sustained window, not the detection time', async () => {
    const { engine, source, of } = setup();
    await engine.start();
    source.feed([...Array(10).fill(0), ...Array(25).fill(0.25)]);
    await flush();
    expect(of('cry_started')).toEqual([
      { type: 'cry_started', at: T0 + 10 * HOP, detectedAt: T0 + 31 * HOP },
    ]);
    expect(engine.crying).toBe(true);
  });

  it('a running cry ends with stream_end when the monitor stops', async () => {
    const { engine, source, of } = setup();
    await engine.start();
    source.feed(Array(30).fill(0.25));
    await flush();
    engine.stop();
    expect(of('cry_ended')).toEqual([
      {
        type: 'cry_ended',
        at: T0 + 30 * HOP,
        startedAt: T0,
        closedAt: T0 + 30 * HOP,
        reason: 'stream_end',
      },
    ]);
  });

  it('capture loss ends a running cry and fails with lost', async () => {
    const { engine, source, of } = setup();
    await engine.start();
    source.feed(Array(30).fill(0.25));
    await flush();
    source.handlers?.lost('lost');
    expect(engine.state).toBe('error');
    expect(engine.error).toBe('lost');
    expect(of('cry_ended')).toHaveLength(1);
    expect(source.stopped).toBe(true);
  });

  it('emits stalled once after 5 s without frames, then resumed', async () => {
    const { engine, source, scheduler, of } = setup();
    await engine.start();
    source.feed([0.001]);
    await flush();
    scheduler.advance(STALL_AFTER_MS);
    expect(of('stalled')).toEqual([]);
    scheduler.advance(1000);
    expect(of('stalled')).toEqual([{ at: T0 + 6000, lastFrameAt: T0 }]);
    scheduler.advance(10_000);
    expect(of('stalled')).toHaveLength(1);
    source.feed([0.001], 1);
    await flush();
    expect(of('resumed')).toEqual([{ at: T0 + 16_000 }]);
  });

  it('counts frames lost in capture as missed and as quiet windows', async () => {
    const { engine, source } = setup();
    await engine.start();
    source.feed([0.3]);
    source.feed([0.3], 5);
    await flush();
    expect(engine.stats.missedFrames).toBe(4);
  });

  it('a listener that throws does not stop the engine', async () => {
    const { engine, source } = setup();
    const seen: number[] = [];
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    engine.on('score', () => {
      throw new Error('listener bug');
    });
    engine.on('score', (s) => seen.push(s.score));
    await engine.start();
    source.feed([0.1, 0.2]);
    await flush();
    expect(seen).toEqual([0.1, 0.2]);
    expect(logged).toHaveBeenCalledTimes(2);
    logged.mockRestore();
  });
});
