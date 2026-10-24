/**
 * Microphone capture of the cry monitor (docs/design/35-cry-engine.md section 2). Asks for the microphone with every
 * voice processing OFF (noise suppression is tuned for speech and may remove a cry, docs/design/31 section 6), reads
 * back what the browser actually applied so the page can warn, and runs the capture worklet that turns the stream
 * into 16 kHz frames of 0.975 s. Frames are handed over as transferred buffers and must be given back (`release`).
 */
import workletUrl from './captureWorklet.ts?worker&url';
import { YAMNET_FRAME_SAMPLES } from './audioFrames';
import {
  CAPTURE_PROCESSOR,
  type WorkletFrameMessage,
  type WorkletInMessage,
} from './captureProtocol';
import { CryEngineError, type CryEngineErrorCode } from './errors';
import { YAMNET_HOP_MS } from './trigger';

export type CaptureErrorCode = Extract<
  CryEngineErrorCode,
  'denied' | 'unavailable' | 'lost' | 'insecure_context' | 'unsupported'
>;

export type ProcessingName = 'echoCancellation' | 'noiseSuppression' | 'autoGainControl';
export const PROCESSING: readonly ProcessingName[] = [
  'echoCancellation',
  'noiseSuppression',
  'autoGainControl',
];

/** What getUserMedia is asked for: mono, no echo cancellation, no noise suppression, no automatic gain. */
export const MICROPHONE_CONSTRAINTS: MediaStreamConstraints = Object.freeze({
  audio: {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
    channelCount: 1,
  },
  video: false,
});

/** One frame of 16 kHz mono audio: `t` = epoch ms of its first sample, `index` = its sequence number. */
export interface AudioFrame {
  index: number;
  t: number;
  samples: Float32Array;
}

export interface CaptureInfo {
  /** Rate of the audio context (the device's), before the worklet resamples to 16 kHz. */
  contextSampleRate: number;
  /** Processing the browser reports as still ON despite the constraints (the page warns about these). */
  processingOn: ProcessingName[];
  /** Processing the browser does not report at all (unknown, e.g. older Safari). */
  processingUnknown: ProcessingName[];
}

export interface AudioSourceHandlers {
  frame(frame: AudioFrame): void;
  /** Capture stopped by itself (track ended or muted, context closed). */
  lost(code: CaptureErrorCode): void;
}

/** The engine's view of a capture: injectable so tests run without a browser audio stack. */
export interface AudioSource {
  start(handlers: AudioSourceHandlers): Promise<CaptureInfo>;
  /** Gives a frame's buffer back for reuse. */
  release(samples: Float32Array): void;
  stop(): void;
}

/** Which of the three processing flags the browser applied, from `track.getSettings()`. */
export function processingReport(
  settings: Partial<Record<ProcessingName, unknown>>,
): Pick<CaptureInfo, 'processingOn' | 'processingUnknown'> {
  return {
    processingOn: PROCESSING.filter((name) => settings[name] === true),
    processingUnknown: PROCESSING.filter((name) => typeof settings[name] !== 'boolean'),
  };
}

/** Maps a getUserMedia rejection to a code (DOMException names, MDN MediaDevices.getUserMedia). */
export function captureErrorCode(error: unknown): CaptureErrorCode {
  const name = (error as { name?: unknown } | null)?.name;
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') return 'denied';
  if (name === 'SecurityError') return 'insecure_context';
  return 'unavailable';
}

/** The browser objects capture needs; injectable for tests. */
export interface CaptureEnvironment {
  isSecureContext: boolean;
  mediaDevices?: Pick<MediaDevices, 'getUserMedia'>;
  createAudioContext?: () => AudioContext;
  createWorkletNode?: (context: AudioContext) => AudioWorkletNode;
  workletUrl: string;
  now: () => number;
}

function browserEnvironment(): CaptureEnvironment {
  const Context =
    typeof AudioContext === 'function'
      ? AudioContext
      : (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  return {
    isSecureContext: globalThis.isSecureContext === true,
    mediaDevices: typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined,
    createAudioContext: Context ? () => new Context({ latencyHint: 'playback' }) : undefined,
    createWorkletNode:
      typeof AudioWorkletNode === 'function'
        ? (context) =>
            new AudioWorkletNode(context, CAPTURE_PROCESSOR, {
              numberOfInputs: 1,
              numberOfOutputs: 1,
              outputChannelCount: [1],
              channelCount: 1,
              channelCountMode: 'explicit',
              channelInterpretation: 'speakers',
            })
        : undefined,
    workletUrl,
    now: () => Date.now(),
  };
}

/**
 * The microphone as an AudioSource. Frame times: the first frame is anchored to the wall clock when it arrives (its
 * first sample was 0.975 s earlier) and every next frame is one hop later, so the trigger sees a regular grid
 * (drift of the audio clock against the wall clock is a few ppm: well under a second per night).
 */
export class MicrophoneSource implements AudioSource {
  private readonly env: CaptureEnvironment;
  private stream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private sink: GainNode | null = null;
  private anchor: number | null = null;
  private stopped = false;
  private handlers: AudioSourceHandlers | null = null;
  private readonly onTrackGone = () => this.fail('lost');

  constructor(env: Partial<CaptureEnvironment> = {}) {
    this.env = { ...browserEnvironment(), ...env };
  }

  async start(handlers: AudioSourceHandlers): Promise<CaptureInfo> {
    const env = this.env;
    if (!env.isSecureContext || !env.mediaDevices?.getUserMedia) {
      throw new CryEngineError('insecure_context', 'microphone capture needs HTTPS or localhost');
    }
    if (!env.createAudioContext || !env.createWorkletNode) {
      throw new CryEngineError('unsupported', 'AudioWorklet is not available');
    }
    this.handlers = handlers;
    let stream: MediaStream;
    try {
      stream = await env.mediaDevices.getUserMedia(MICROPHONE_CONSTRAINTS);
    } catch (error) {
      throw new CryEngineError(captureErrorCode(error), String(error));
    }
    this.stream = stream;
    if (this.stopped) {
      this.stop();
      throw new CryEngineError('lost', 'stopped while starting');
    }
    const track = stream.getAudioTracks()[0];
    if (!track) {
      this.stop();
      throw new CryEngineError('unavailable', 'no audio track');
    }
    const report = processingReport(
      (track.getSettings?.() ?? {}) as Partial<Record<ProcessingName, unknown>>,
    );
    track.addEventListener('ended', this.onTrackGone);
    track.addEventListener('mute', this.onTrackGone);

    try {
      const context = env.createAudioContext();
      this.context = context;
      await context.audioWorklet.addModule(env.workletUrl);
      const node = env.createWorkletNode(context);
      this.node = node;
      node.port.onmessage = (event: MessageEvent<WorkletFrameMessage>) => this.onFrame(event.data);
      // A silent sink keeps the node pulled by the graph on every engine; nothing is played.
      const sink = context.createGain();
      sink.gain.value = 0;
      this.sink = sink;
      context.createMediaStreamSource(stream).connect(node);
      node.connect(sink);
      sink.connect(context.destination);
      await context.resume();
      return { contextSampleRate: context.sampleRate, ...report };
    } catch (error) {
      this.stop();
      throw error instanceof CryEngineError
        ? error
        : new CryEngineError('unsupported', String(error));
    }
  }

  release(samples: Float32Array): void {
    if (!this.node || this.stopped || samples.length !== YAMNET_FRAME_SAMPLES) return;
    const message: WorkletInMessage = { type: 'release', samples };
    this.node.port.postMessage(message, [samples.buffer]);
  }

  stop(): void {
    this.stopped = true;
    const track = this.stream?.getAudioTracks()[0];
    track?.removeEventListener('ended', this.onTrackGone);
    track?.removeEventListener('mute', this.onTrackGone);
    if (this.node) {
      const message: WorkletInMessage = { type: 'stop' };
      this.node.port.postMessage(message);
      this.node.port.onmessage = null;
      this.node.disconnect();
    }
    this.sink?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    void this.context?.close().catch(() => undefined);
    this.node = null;
    this.sink = null;
    this.stream = null;
    this.context = null;
    this.handlers = null;
  }

  private onFrame(message: WorkletFrameMessage): void {
    if (message.type !== 'frame' || this.stopped || !this.handlers) return;
    if (this.anchor === null) {
      this.anchor = this.env.now() - YAMNET_HOP_MS - message.index * YAMNET_HOP_MS;
    }
    this.handlers.frame({
      index: message.index,
      t: this.anchor + message.index * YAMNET_HOP_MS,
      samples: message.samples,
    });
  }

  private fail(code: CaptureErrorCode): void {
    const handlers = this.handlers;
    if (this.stopped || !handlers) return;
    this.stop();
    handlers.lost(code);
  }
}
