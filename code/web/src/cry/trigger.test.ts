import { describe, expect, it } from 'vitest';
import {
  CryTrigger,
  DEFAULT_CRY_TRIGGER,
  triggerWindows,
  YAMNET_HOP_MS,
  type CryTriggerConfig,
  type CryTriggerEvent,
} from './trigger';
import vectors from './cryTriggerVectors.json';

/*
 * The TypeScript trigger against the Python reference (ml/cry_detector/cry_detector/trigger.py) through the shared
 * vectors written by `python -m cry_detector.make_vectors`, plus the streaming-only behaviour (tick, gaps, finish).
 */

interface VectorEvent {
  startWindow: number;
  detectedAfterWindow: number;
  endWindow: number;
  closedWindows: number;
  closedByStreamEnd: boolean;
  startS: number;
  triggerS: number;
  endS: number;
  closedS: number;
}

const HOP = YAMNET_HOP_MS;
const T0 = Date.UTC(2026, 9, 24, 21, 0);

function run(config: CryTriggerConfig, scores: number[], t0 = 0): CryTriggerEvent[] {
  const trigger = new CryTrigger(config);
  const events = scores.flatMap((score, i) => trigger.push({ t: t0 + i * HOP, score }));
  return [...events, ...trigger.finish()];
}

describe('shared vectors (trigger.py)', () => {
  it('uses the YAMNet hop', () => {
    expect(vectors.hopSeconds * 1000).toBe(HOP);
    expect(vectors.cases.length).toBeGreaterThanOrEqual(10);
  });

  it.each(vectors.cases.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    const scores = c.scores.split(' ').map(Number);
    expect(scores).toHaveLength(c.windows);
    const events = run(c.config, scores);
    const expected = (c.events as VectorEvent[]).flatMap((e) => [
      {
        type: 'cry_started',
        at: e.startWindow * HOP,
        detectedAt: (e.detectedAfterWindow + 1) * HOP,
      },
      {
        type: 'cry_ended',
        at: (e.endWindow + 1) * HOP,
        startedAt: e.startWindow * HOP,
        closedAt: e.closedWindows * HOP,
        reason: e.closedByStreamEnd ? 'stream_end' : 'quiet',
      },
    ]);
    expect(events).toEqual(expected);
    // The Python seconds agree with the window arithmetic.
    for (const e of c.events as VectorEvent[]) {
      expect(Math.round(e.startS * 1000)).toBe(e.startWindow * HOP);
      expect(Math.round(e.triggerS * 1000)).toBe((e.detectedAfterWindow + 1) * HOP);
      expect(Math.round(e.endS * 1000)).toBe((e.endWindow + 1) * HOP);
      expect(Math.round(e.closedS * 1000)).toBe(e.closedWindows * HOP);
    }
  });

  it('keeps absolute times (epoch ms) as given by the frames', () => {
    const c = vectors.cases.find((v) => v.name === 'one_cry')!;
    const scores = c.scores.split(' ').map(Number);
    const relative = run(c.config, scores);
    const absolute = run(c.config, scores, T0);
    expect(absolute).toEqual(
      relative.map((e) =>
        e.type === 'cry_started'
          ? { ...e, at: e.at + T0, detectedAt: e.detectedAt + T0 }
          : { ...e, at: e.at + T0, startedAt: e.startedAt + T0, closedAt: e.closedAt + T0 },
      ),
    );
  });
});

describe('rule arithmetic (windows_for)', () => {
  it('rounds seconds to windows as Python does', () => {
    expect(triggerWindows(DEFAULT_CRY_TRIGGER)).toEqual({ window: 62, need: 21, quiet: 185 });
    expect(
      triggerWindows({
        ...DEFAULT_CRY_TRIGGER,
        windowSeconds: 30,
        minSeconds: 20,
        quietSeconds: 180,
      }),
    ).toEqual({ window: 31, need: 21, quiet: 185 });
  });

  it('refuses impossible rules', () => {
    expect(() => triggerWindows({ ...DEFAULT_CRY_TRIGGER, minSeconds: 90 })).toThrow(RangeError);
    expect(() => triggerWindows({ ...DEFAULT_CRY_TRIGGER, quietSeconds: 30 })).toThrow(RangeError);
    expect(() => triggerWindows({ ...DEFAULT_CRY_TRIGGER, smoothing: 0 })).toThrow(RangeError);
  });
});

describe('streaming behaviour', () => {
  const cry = (n: number) => Array.from({ length: n }, () => 0.3);
  const quiet = (n: number) => Array.from({ length: n }, () => 0);

  it('starts at the first active window, decided after 21 active windows', () => {
    const trigger = new CryTrigger();
    const scores = [...quiet(10), ...cry(30)];
    const events = scores.flatMap((score, i) => trigger.push({ t: T0 + i * HOP, score }));
    expect(events).toEqual([{ type: 'cry_started', at: T0 + 10 * HOP, detectedAt: T0 + 31 * HOP }]);
    expect(trigger.crying).toBe(true);
    expect(trigger.smoothedScore).toBeCloseTo(0.3, 12);
  });

  it('ignores duplicate and older frames', () => {
    const trigger = new CryTrigger();
    trigger.push({ t: T0, score: 0.5 });
    expect(trigger.push({ t: T0, score: 0.5 })).toEqual([]);
    expect(trigger.push({ t: T0 - HOP, score: 0.5 })).toEqual([]);
    expect(trigger.lastFrameT).toBe(T0);
  });

  it('counts lost frames as quiet windows', () => {
    const withGap = new CryTrigger();
    const filled = new CryTrigger();
    const scores = [...cry(30), ...quiet(5), ...cry(5)];
    const a: CryTriggerEvent[] = [];
    const b: CryTriggerEvent[] = [];
    scores.forEach((score, i) => {
      b.push(...filled.push({ t: i * HOP, score }));
      if (score > 0 || i === scores.length - 1) a.push(...withGap.push({ t: i * HOP, score }));
    });
    expect(a).toEqual(b);
    expect(withGap.smoothedScore).toBe(filled.smoothedScore);
  });

  it('closes a cry on tick when frames stop, at the same times push would give', () => {
    const raw = { ...DEFAULT_CRY_TRIGGER, smoothing: 1 };
    const scores = [...cry(40), ...quiet(185)];
    const flowing = run(raw, scores, T0);
    const stalled = new CryTrigger(raw);
    const events = scores
      .slice(0, 40)
      .flatMap((score, i) => stalled.push({ t: T0 + i * HOP, score }));
    const closesAt = T0 + 39 * HOP + 186 * HOP;
    expect(stalled.tick(closesAt)).toEqual([]); // the closing frame may still be on its way
    events.push(...stalled.tick(closesAt + HOP));
    expect(events).toEqual(flowing.slice(0, 2));
    expect(stalled.crying).toBe(false);
    // A late frame of the decided quiet period is ignored; a new cry counts fresh windows.
    expect(stalled.push({ t: T0 + 100 * HOP, score: 0.9 })).toEqual([]);
    const later = T0 + 400 * HOP;
    const again = cry(25).flatMap((score, i) => stalled.push({ t: later + i * HOP, score }));
    expect(again).toEqual([{ type: 'cry_started', at: later, detectedAt: later + 21 * HOP }]);
  });

  it('finish() closes a running cry at the end of the last window, and nothing otherwise', () => {
    const trigger = new CryTrigger();
    expect(trigger.finish()).toEqual([]);
    cry(30).forEach((score, i) => trigger.push({ t: T0 + i * HOP, score }));
    expect(trigger.finish()).toEqual([
      {
        type: 'cry_ended',
        at: T0 + 30 * HOP,
        startedAt: T0,
        closedAt: T0 + 30 * HOP,
        reason: 'stream_end',
      },
    ]);
    expect(trigger.finish()).toEqual([]);
  });

  it('treats the threshold as inclusive', () => {
    const at = { ...DEFAULT_CRY_TRIGGER, smoothing: 1 };
    expect(
      run(
        at,
        Array.from({ length: 21 }, () => 0.02),
      ),
    ).toHaveLength(2);
    expect(
      run(
        at,
        Array.from({ length: 21 }, () => 0.0199),
      ),
    ).toHaveLength(0);
  });
});
