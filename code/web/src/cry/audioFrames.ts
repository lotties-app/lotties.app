/**
 * Audio-thread helpers of the capture worklet (captureWorklet.ts), pure and allocation-free in steady state so they
 * run in an AudioWorkletGlobalScope and in unit tests alike: mono downmix, a streaming windowed-sinc resampler to
 * 16 kHz, and the assembly of YAMNet frames (15600 samples = 0.975 s, non-overlapping, as MediaPipe's task) into a
 * small pool of buffers that travel to the classifier and back (transferred, never copied).
 */

export const YAMNET_SAMPLE_RATE = 16_000;
export const YAMNET_FRAME_SAMPLES = 15_600;

/** Something that takes resampled samples one at a time. */
export interface SampleSink {
  push(sample: number): void;
}

/** Averages the channels of one render quantum into `out` (length = samples written). */
export function downmix(channels: readonly Float32Array[], out: Float32Array): number {
  const count = channels.length;
  if (count === 0) return 0;
  const n = Math.min(channels[0].length, out.length);
  if (count === 1) {
    out.set(channels[0].subarray(0, n));
    return n;
  }
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let c = 0; c < count; c++) sum += channels[c][i];
    out[i] = sum / count;
  }
  return n;
}

/**
 * Streaming band-limited resampler (Blackman-windowed sinc, `zeroCrossings` lobes each side, kernel read from a
 * table with linear interpolation). Low-pass at 92 % of the lower Nyquist so a 48 kHz microphone does not alias
 * into YAMNet's band (its mel bank stops at 7.5 kHz). Output gain is normalised to 1 at DC for every phase.
 */
export class StreamResampler {
  readonly inRate: number;
  readonly outRate: number;
  private readonly step: number;
  private readonly halfWidth: number;
  private readonly table: Float32Array;
  private readonly resolution: number;
  private buf: Float32Array;
  /** Global input index of buf[0] (negative at first: zero history before the first sample). */
  private bufStart: number;
  private bufLen = 0;
  /** Output samples produced so far; the next one sits at input position produced * step. */
  private produced = 0;

  constructor(
    inRate: number,
    outRate: number = YAMNET_SAMPLE_RATE,
    zeroCrossings = 8,
    resolution = 128,
  ) {
    if (!(inRate > 0) || !(outRate > 0)) throw new RangeError('invalid sample rate');
    this.inRate = inRate;
    this.outRate = outRate;
    this.step = inRate / outRate;
    const cutoff = 0.5 * Math.min(1, outRate / inRate) * 0.92; // cycles per input sample
    this.halfWidth = zeroCrossings / (2 * cutoff);
    this.resolution = resolution;
    const size = Math.ceil(this.halfWidth * resolution) + 2;
    this.table = new Float32Array(size);
    for (let i = 0; i < size; i++) {
      const x = i / resolution;
      if (x >= this.halfWidth) break;
      const sinc = x === 0 ? 1 : Math.sin(2 * Math.PI * cutoff * x) / (2 * Math.PI * cutoff * x);
      const r = x / this.halfWidth; // 0..1 from the centre
      const window = 0.42 + 0.5 * Math.cos(Math.PI * r) + 0.08 * Math.cos(2 * Math.PI * r);
      this.table[i] = sinc * window;
    }
    const history = Math.ceil(this.halfWidth) + 1;
    this.buf = new Float32Array(4096 + 2 * history);
    this.bufStart = -history;
    this.bufLen = history; // zeros
  }

  /** Feeds `length` input samples; every output sample that can be computed goes to `sink`. */
  process(input: Float32Array, length: number, sink: SampleSink): void {
    if (this.step === 1) {
      for (let i = 0; i < length; i++) sink.push(input[i]);
      return;
    }
    this.append(input, length);
    const lastIndex = this.bufStart + this.bufLen - 1;
    for (;;) {
      const centre = this.produced * this.step;
      if (centre + this.halfWidth > lastIndex) break;
      sink.push(this.sampleAt(centre));
      this.produced++;
    }
    this.compact(Math.floor(this.produced * this.step - this.halfWidth) - 1);
  }

  private sampleAt(centre: number): number {
    const lo = Math.ceil(centre - this.halfWidth);
    const hi = Math.floor(centre + this.halfWidth);
    let sum = 0;
    let weights = 0;
    for (let i = lo; i <= hi; i++) {
      const d = Math.abs(i - centre) * this.resolution;
      const j = Math.floor(d);
      const f = d - j;
      const w = this.table[j] + (this.table[j + 1] - this.table[j]) * f;
      sum += this.buf[i - this.bufStart] * w;
      weights += w;
    }
    return weights !== 0 ? sum / weights : 0;
  }

  private append(input: Float32Array, length: number): void {
    if (this.bufLen + length > this.buf.length) {
      // Only when a render quantum is larger than the spare room (never with 128-sample quanta).
      const bigger = new Float32Array((this.bufLen + length) * 2);
      bigger.set(this.buf.subarray(0, this.bufLen));
      this.buf = bigger;
    }
    this.buf.set(input.subarray(0, length), this.bufLen);
    this.bufLen += length;
  }

  /** Drops input samples before global index `keepFrom`. */
  private compact(keepFrom: number): void {
    const drop = keepFrom - this.bufStart;
    if (drop <= 0 || drop < this.buf.length / 2) return;
    this.buf.copyWithin(0, drop, this.bufLen);
    this.bufLen -= drop;
    this.bufStart = keepFrom;
  }
}

export interface FramePoolOptions {
  frameSamples?: number;
  /** Buffers allocated up front. */
  initial?: number;
  /** Most frames out at once (sent, not yet given back); beyond that a frame is dropped, never queued. */
  maxInFlight?: number;
}

/**
 * Fills pooled frames sample by sample. A full frame goes to `emit` with its sequence number; ownership passes to the
 * receiver until it comes back through `release`. A dropped frame (pool exhausted: the classifier is far behind)
 * still takes its sequence number, so the receiver sees the gap.
 */
export class FrameAssembler implements SampleSink {
  readonly frameSamples: number;
  private readonly maxInFlight: number;
  private readonly free: Float32Array[] = [];
  private current: Float32Array | null;
  private fill = 0;
  private index = 0;
  private inFlight = 0;
  allocated = 0;
  dropped = 0;

  constructor(
    private readonly emit: (samples: Float32Array, index: number) => void,
    options: FramePoolOptions = {},
  ) {
    this.frameSamples = options.frameSamples ?? YAMNET_FRAME_SAMPLES;
    this.maxInFlight = options.maxInFlight ?? 8;
    for (let i = 0; i < (options.initial ?? 4); i++) this.free.push(this.allocate());
    this.current = this.take();
  }

  push(sample: number): void {
    if (this.current !== null) this.current[this.fill] = sample;
    if (++this.fill < this.frameSamples) return;
    const full = this.current;
    const index = this.index++;
    this.fill = 0;
    if (full === null) {
      this.dropped++;
    } else {
      this.inFlight++;
      this.emit(full, index);
    }
    this.current = this.take();
  }

  /** A frame buffer given back by the receiver (same length; a foreign size is ignored). */
  release(samples: Float32Array): void {
    if (samples.length !== this.frameSamples) return;
    this.inFlight = Math.max(0, this.inFlight - 1);
    this.free.push(samples);
  }

  /** A frame that starts without a buffer stays dropped to its end: never half-filled. */
  private take(): Float32Array | null {
    const next = this.free.pop();
    if (next) return next;
    return this.inFlight < this.maxInFlight ? this.allocate() : null;
  }

  private allocate(): Float32Array {
    this.allocated++;
    return new Float32Array(this.frameSamples);
  }
}
