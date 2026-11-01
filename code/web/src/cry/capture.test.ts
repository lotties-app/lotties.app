import { describe, expect, it, vi } from 'vitest';
import { YAMNET_FRAME_SAMPLES } from './audioFrames';
import {
  captureErrorCode,
  MICROPHONE_CONSTRAINTS,
  MicrophoneSource,
  processingReport,
  type AudioFrame,
  type CaptureEnvironment,
} from './capture';
import type { WorkletFrameMessage } from './captureProtocol';
import { CryEngineError } from './errors';

/* Capture with a mocked getUserMedia and Web Audio graph: what is asked for, what is reported, how it fails. */

class FakeTrack extends EventTarget {
  stopped = false;
  constructor(private readonly settings: Record<string, unknown>) {
    super();
  }
  getSettings() {
    return this.settings;
  }
  stop() {
    this.stopped = true;
  }
}

function fakeEnvironment(settings: Record<string, unknown> = {}, getUserMediaError?: unknown) {
  const track = new FakeTrack(settings);
  const stream = { getAudioTracks: () => [track], getTracks: () => [track] };
  const getUserMedia = vi.fn(async () => {
    if (getUserMediaError) throw getUserMediaError;
    return stream as unknown as MediaStream;
  });
  const port = {
    onmessage: null as ((event: MessageEvent<WorkletFrameMessage>) => void) | null,
    postMessage: vi.fn(),
  };
  const node = { port, connect: vi.fn(), disconnect: vi.fn() };
  const context = {
    sampleRate: 48000,
    destination: {},
    audioWorklet: { addModule: vi.fn(async () => {}) },
    createGain: () => ({ gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() }),
    createMediaStreamSource: vi.fn(() => ({ connect: vi.fn() })),
    resume: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
  };
  let now = Date.UTC(2026, 9, 24, 22, 0);
  const env: Partial<CaptureEnvironment> = {
    isSecureContext: true,
    mediaDevices: { getUserMedia },
    createAudioContext: () => context as unknown as AudioContext,
    createWorkletNode: () => node as unknown as AudioWorkletNode,
    workletUrl: '/assets/captureWorklet.js',
    now: () => now,
  };
  return {
    env,
    track,
    getUserMedia,
    port,
    context,
    setNow: (t: number) => (now = t),
    frame: (index: number) => {
      const samples = new Float32Array(YAMNET_FRAME_SAMPLES);
      port.onmessage?.({ data: { type: 'frame', index, samples, dropped: 0 } } as MessageEvent);
      return samples;
    },
  };
}

const handlers = () => {
  const frames: AudioFrame[] = [];
  const lost = vi.fn();
  return { frames, lost, h: { frame: (f: AudioFrame) => frames.push(f), lost } };
};

describe('microphone constraints', () => {
  it('asks for mono audio with echo cancellation, noise suppression and AGC off', async () => {
    const fake = fakeEnvironment({
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    });
    const source = new MicrophoneSource(fake.env);
    const info = await source.start(handlers().h);
    expect(fake.getUserMedia).toHaveBeenCalledWith(MICROPHONE_CONSTRAINTS);
    expect(MICROPHONE_CONSTRAINTS).toEqual({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 1,
      },
      video: false,
    });
    expect(info).toEqual({ contextSampleRate: 48000, processingOn: [], processingUnknown: [] });
    expect(fake.context.audioWorklet.addModule).toHaveBeenCalledWith('/assets/captureWorklet.js');
    expect(fake.context.resume).toHaveBeenCalled();
    source.stop();
  });

  it('reports processing the browser left on, and what it does not report', () => {
    expect(processingReport({ echoCancellation: false, noiseSuppression: true })).toEqual({
      processingOn: ['noiseSuppression'],
      processingUnknown: ['autoGainControl'],
    });
  });
});

describe('capture failures', () => {
  it.each([
    ['NotAllowedError', 'denied'],
    ['SecurityError', 'insecure_context'],
    ['NotFoundError', 'unavailable'],
    ['NotReadableError', 'unavailable'],
    ['OverconstrainedError', 'unavailable'],
  ])('%s -> %s', async (name, code) => {
    expect(captureErrorCode({ name })).toBe(code);
    const fake = fakeEnvironment({}, Object.assign(new Error(name), { name }));
    await expect(new MicrophoneSource(fake.env).start(handlers().h)).rejects.toMatchObject({
      code,
    });
  });

  it('needs a secure context with mediaDevices', async () => {
    const fake = fakeEnvironment();
    for (const env of [
      { ...fake.env, isSecureContext: false },
      { ...fake.env, mediaDevices: undefined },
    ]) {
      const error = await new MicrophoneSource(env).start(handlers().h).catch((e) => e);
      expect(error).toBeInstanceOf(CryEngineError);
      expect(error.code).toBe('insecure_context');
    }
    expect(fake.getUserMedia).not.toHaveBeenCalled();
  });

  it('is unsupported without AudioWorklet', async () => {
    const fake = fakeEnvironment();
    const env = { ...fake.env, createWorkletNode: undefined };
    await expect(new MicrophoneSource(env).start(handlers().h)).rejects.toMatchObject({
      code: 'unsupported',
    });
  });

  it.each(['ended', 'mute'])('reports lost when the track is %s, once, and stops', async (type) => {
    const fake = fakeEnvironment();
    const { h, lost } = handlers();
    await new MicrophoneSource(fake.env).start(h);
    fake.track.dispatchEvent(new Event(type));
    fake.track.dispatchEvent(new Event(type));
    expect(lost).toHaveBeenCalledTimes(1);
    expect(lost).toHaveBeenCalledWith('lost');
    expect(fake.track.stopped).toBe(true);
    expect(fake.context.close).toHaveBeenCalled();
  });
});

describe('frames', () => {
  it('times frames on a regular grid anchored at the first one', async () => {
    const fake = fakeEnvironment();
    const { h, frames } = handlers();
    await new MicrophoneSource(fake.env).start(h);
    const t = Date.UTC(2026, 9, 24, 22, 0, 5);
    fake.setNow(t);
    fake.frame(0);
    fake.setNow(t + 990); // late delivery does not move the grid
    fake.frame(1);
    expect(frames.map((f) => [f.index, f.t])).toEqual([
      [0, t - 975],
      [1, t],
    ]);
  });

  it('gives buffers back to the worklet as transfers and stops it', async () => {
    const fake = fakeEnvironment();
    const source = new MicrophoneSource(fake.env);
    await source.start(handlers().h);
    const samples = fake.frame(0);
    source.release(samples);
    expect(fake.port.postMessage).toHaveBeenCalledWith({ type: 'release', samples }, [
      samples.buffer,
    ]);
    source.stop();
    expect(fake.port.postMessage).toHaveBeenLastCalledWith({ type: 'stop' });
    expect(fake.track.stopped).toBe(true);
    source.release(samples);
    expect(fake.port.postMessage).toHaveBeenCalledTimes(2);
  });
});
