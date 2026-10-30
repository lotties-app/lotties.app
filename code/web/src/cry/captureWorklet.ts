/**
 * AudioWorklet processor of the cry monitor (loaded by capture.ts through `?worker&url`, built as its own ES module).
 * Runs on the audio thread: downmixes to mono, resamples to 16 kHz and posts each full 0.975 s frame to the main
 * thread as a transferred buffer; the buffer comes back with `release` after classification, so the steady state
 * allocates nothing. No sample is kept beyond the frame being filled; nothing is stored or sent anywhere else.
 */
import { downmix, FrameAssembler, StreamResampler } from './audioFrames';
import {
  CAPTURE_PROCESSOR,
  type WorkletFrameMessage,
  type WorkletInMessage,
} from './captureProtocol';

// The AudioWorkletGlobalScope API (not part of TypeScript's DOM lib).
declare const sampleRate: number;
declare function registerProcessor(name: string, ctor: unknown): void;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(options?: unknown);
}

class CryCaptureProcessor extends AudioWorkletProcessor {
  private readonly resampler = new StreamResampler(sampleRate);
  private readonly frames: FrameAssembler;
  private mono = new Float32Array(128);
  private stopped = false;

  constructor(options?: unknown) {
    super(options);
    this.frames = new FrameAssembler((samples, index) => {
      const message: WorkletFrameMessage = {
        type: 'frame',
        index,
        samples,
        dropped: this.frames.dropped,
      };
      this.port.postMessage(message, [samples.buffer]);
    });
    this.port.onmessage = (event: MessageEvent<WorkletInMessage>) => {
      if (event.data.type === 'release') this.frames.release(event.data.samples);
      else if (event.data.type === 'stop') this.stopped = true;
    };
  }

  process(inputs: Float32Array[][]): boolean {
    if (this.stopped) return false;
    const channels = inputs[0];
    if (!channels || channels.length === 0) return true;
    if (this.mono.length < channels[0].length) this.mono = new Float32Array(channels[0].length);
    const n = downmix(channels, this.mono);
    this.resampler.process(this.mono, n, this.frames);
    return true;
  }
}

registerProcessor(CAPTURE_PROCESSOR, CryCaptureProcessor);
