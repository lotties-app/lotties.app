import { describe, expect, it } from 'vitest';
import {
  downmix,
  FrameAssembler,
  StreamResampler,
  YAMNET_FRAME_SAMPLES,
  type SampleSink,
} from './audioFrames';

class Collect implements SampleSink {
  out: number[] = [];
  push(sample: number) {
    this.out.push(sample);
  }
}

const tone = (rate: number, hz: number, seconds: number, amp = 0.5) =>
  Float32Array.from(
    { length: Math.round(rate * seconds) },
    (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / rate),
  );

/** Feeds `input` in render quanta of `quantum` samples. */
function resample(inRate: number, input: Float32Array, quantum = 128): number[] {
  const r = new StreamResampler(inRate);
  const sink = new Collect();
  for (let i = 0; i < input.length; i += quantum) {
    const chunk = input.subarray(i, i + quantum);
    r.process(chunk, chunk.length, sink);
  }
  return sink.out;
}

const rms = (x: number[]) => Math.sqrt(x.reduce((s, v) => s + v * v, 0) / x.length);

describe('StreamResampler', () => {
  it('keeps a 1 kHz tone from 48 kHz at 16 kHz with its level and pitch', () => {
    const out = resample(48000, tone(48000, 1000, 1));
    expect(out.length).toBeGreaterThan(15900);
    expect(out.length).toBeLessThanOrEqual(16000);
    const steady = out.slice(200, 15800);
    expect(rms(steady)).toBeCloseTo(0.5 / Math.SQRT2, 2);
    let crossings = 0;
    for (let i = 1; i < steady.length; i++) if (steady[i - 1] < 0 && steady[i] >= 0) crossings++;
    expect(Math.abs(crossings - (steady.length / 16000) * 1000)).toBeLessThanOrEqual(1);
  });

  it('removes content above 8 kHz instead of folding it into the band', () => {
    const out = resample(48000, tone(48000, 12000, 1)).slice(200, 15800);
    expect(20 * Math.log10(rms(out) / (0.5 / Math.SQRT2))).toBeLessThan(-40);
  });

  it('handles 44.1 kHz and gives the same output whatever the chunk size', () => {
    const input = tone(44100, 440, 0.5);
    const a = resample(44100, input, 128);
    const b = resample(44100, input, 1000);
    expect(a.length).toBe(b.length);
    expect(Math.abs(a.length - 8000)).toBeLessThan(40);
    a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 6));
  });

  it('passes 16 kHz through unchanged', () => {
    const input = tone(16000, 300, 0.1);
    expect(resample(16000, input)).toEqual(Array.from(input));
  });
});

describe('downmix', () => {
  it('averages channels and copies mono', () => {
    const out = new Float32Array(3);
    expect(downmix([Float32Array.of(1, 0, -1), Float32Array.of(0, 0, 1)], out)).toBe(3);
    expect(Array.from(out)).toEqual([0.5, 0, 0]);
    expect(downmix([Float32Array.of(0.25, 0.5)], out)).toBe(2);
    expect(Array.from(out.subarray(0, 2))).toEqual([0.25, 0.5]);
    expect(downmix([], out)).toBe(0);
  });
});

describe('FrameAssembler', () => {
  it('emits full 15600-sample frames with increasing indices', () => {
    const frames: [Float32Array, number][] = [];
    const a = new FrameAssembler((samples, index) => frames.push([samples, index]));
    for (let i = 0; i < YAMNET_FRAME_SAMPLES * 2 + 10; i++) a.push(i);
    expect(frames.map(([s, i]) => [s.length, i, s[0]])).toEqual([
      [YAMNET_FRAME_SAMPLES, 0, 0],
      [YAMNET_FRAME_SAMPLES, 1, YAMNET_FRAME_SAMPLES],
    ]);
  });

  it('reuses released buffers: no allocation in steady state', () => {
    const a = new FrameAssembler((samples) => a.release(samples), { frameSamples: 4, initial: 2 });
    for (let i = 0; i < 4 * 1000; i++) a.push(i);
    expect(a.allocated).toBe(2);
    expect(a.dropped).toBe(0);
  });

  it('drops whole frames (keeping their numbers) when the receiver holds every buffer', () => {
    const held: number[] = [];
    const a = new FrameAssembler((_, index) => held.push(index), {
      frameSamples: 2,
      initial: 1,
      maxInFlight: 2,
    });
    for (let i = 0; i < 2 * 5; i++) a.push(i);
    expect(held).toEqual([0, 1]);
    expect(a.dropped).toBe(3);
    expect(a.allocated).toBe(2);
  });

  it('ignores a buffer of another size', () => {
    const a = new FrameAssembler(() => {}, { frameSamples: 4, initial: 1 });
    a.release(new Float32Array(3));
    for (let i = 0; i < 4; i++) a.push(i);
    expect(a.allocated).toBe(2); // the foreign buffer was not taken as the next frame
  });
});
