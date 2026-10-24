/**
 * The classifier's logic, free of MediaPipe imports so it runs in unit tests: model checks, label resolution by
 * name, score extraction and timing. classifier.worker.ts plugs the real `@mediapipe/tasks-audio` into it.
 */
import { YAMNET_FRAME_SAMPLES, YAMNET_SAMPLE_RATE } from './audioFrames';
import { CryEngineError } from './errors';

/** The AudioSet class the zero-shot detector reads (YAMNet index 20; resolved by name, never by index). */
export const CRY_CLASS_NAME = 'Baby cry, infant cry';

/** The parts of MediaPipe's types the engine uses (structural, so tests can fake them). */
export interface CategoryLike {
  index: number;
  score: number;
  categoryName: string;
  displayName?: string;
}
export interface ClassificationResultLike {
  classifications: { categories: CategoryLike[] }[];
}
export interface AudioClassifierLike {
  classify(samples: Float32Array, sampleRate?: number): ClassificationResultLike[];
  close(): void;
}
export interface WasmFilesetLike {
  wasmLoaderPath: string;
  wasmBinaryPath: string;
}
export interface AudioTasksLike {
  AudioClassifier: {
    createFromOptions(
      fileset: WasmFilesetLike,
      options: { baseOptions: { modelAssetBuffer: Uint8Array }; maxResults: number },
    ): Promise<AudioClassifierLike>;
  };
}

/** The categories of the first classification of the first result. */
function categoriesOf(results: ClassificationResultLike[]): CategoryLike[] {
  return results[0]?.classifications[0]?.categories ?? [];
}

/** Index of the category named `name` in the model's label map; class_missing when there is none. */
export function resolveCategoryIndex(
  results: ClassificationResultLike[],
  name: string = CRY_CLASS_NAME,
): number {
  const match = categoriesOf(results).find(
    (c) => c.categoryName === name || c.displayName === name,
  );
  if (!match) throw new CryEngineError('class_missing', `the model has no "${name}" class`);
  return match.index;
}

/** Score of the category at `index` (0 when the result does not list it). */
export function scoreOf(results: ClassificationResultLike[], index: number): number {
  const match = categoriesOf(results).find((c) => c.index === index);
  return match ? match.score : 0;
}

/** TensorFlow Lite flatbuffers carry the file identifier "TFL3" at bytes 4-7. */
export function isTfliteModel(bytes: Uint8Array): boolean {
  return (
    bytes.length > 8 &&
    bytes[4] === 0x54 && // T
    bytes[5] === 0x46 && // F
    bytes[6] === 0x4c && // L
    bytes[7] === 0x33 // 3
  );
}

export function toHex(digest: ArrayBuffer): string {
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * The model response must be the pinned file: a 404, or the SPA's index.html served for a missing path (dev server,
 * a proxy without the /models/ rule), is model_missing; anything else that is not the pinned TFLite is model_invalid.
 */
export async function checkedModelBytes(
  response: Pick<Response, 'ok' | 'status' | 'headers' | 'arrayBuffer'>,
  expectedSha256: string,
  subtle: Pick<SubtleCrypto, 'digest'>,
): Promise<Uint8Array> {
  const type = response.headers.get('content-type') ?? '';
  if (!response.ok || type.includes('text/html')) {
    throw new CryEngineError('model_missing', `model not found (HTTP ${response.status})`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!isTfliteModel(bytes)) throw new CryEngineError('model_invalid', 'not a TFLite model');
  const digest = toHex(await subtle.digest('SHA-256', bytes));
  if (digest !== expectedSha256) {
    throw new CryEngineError('model_invalid', `model checksum ${digest} is not the pinned one`);
  }
  return bytes;
}

/** A tiny module using a v128 instruction: true when WebAssembly SIMD is available (the module WASM needs it). */
export function wasmSimdSupported(wasm: typeof WebAssembly | undefined = globalThis.WebAssembly) {
  if (!wasm || typeof wasm.validate !== 'function') return false;
  try {
    return wasm.validate(
      new Uint8Array([
        0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0,
        253, 15, 253, 98, 11,
      ]),
    );
  } catch {
    return false;
  }
}

export interface LoadRequest {
  modelUrl: string;
  modelSha256: string;
  wasmLoaderUrl: string;
  wasmBinaryUrl: string;
  className?: string;
}

export interface LoadedInfo {
  categoryIndex: number;
  categoryName: string;
  loadMs: number;
}

export interface ServiceDeps {
  loadTasks: () => Promise<AudioTasksLike>;
  fetch: (url: string) => Promise<Pick<Response, 'ok' | 'status' | 'headers' | 'arrayBuffer'>>;
  subtle: Pick<SubtleCrypto, 'digest'>;
  now: () => number;
  wasm?: typeof WebAssembly;
}

/** One classifier inside the worker: load once, classify frame by frame, close. */
export class ClassifierService {
  private classifier: AudioClassifierLike | null = null;
  private categoryIndex = -1;

  constructor(private readonly deps: ServiceDeps) {}

  async load(request: LoadRequest): Promise<LoadedInfo> {
    const started = this.deps.now();
    if (!wasmSimdSupported(this.deps.wasm)) {
      throw new CryEngineError('unsupported', 'WebAssembly SIMD is not available');
    }
    let response: Awaited<ReturnType<ServiceDeps['fetch']>>;
    try {
      response = await this.deps.fetch(request.modelUrl);
    } catch (error) {
      throw new CryEngineError('model_missing', `model download failed: ${String(error)}`);
    }
    const bytes = await checkedModelBytes(response, request.modelSha256, this.deps.subtle);
    let classifier: AudioClassifierLike;
    try {
      const tasks = await this.deps.loadTasks();
      classifier = await tasks.AudioClassifier.createFromOptions(
        { wasmLoaderPath: request.wasmLoaderUrl, wasmBinaryPath: request.wasmBinaryUrl },
        { baseOptions: { modelAssetBuffer: bytes }, maxResults: -1 },
      );
    } catch (error) {
      throw new CryEngineError('classifier_failed', `classifier load failed: ${String(error)}`);
    }
    const name = request.className ?? CRY_CLASS_NAME;
    try {
      // One silent frame lists every category with its name: the label map.
      const probe = classifier.classify(new Float32Array(YAMNET_FRAME_SAMPLES), YAMNET_SAMPLE_RATE);
      this.categoryIndex = resolveCategoryIndex(probe, name);
    } catch (error) {
      classifier.close();
      throw error;
    }
    this.classifier = classifier;
    return {
      categoryIndex: this.categoryIndex,
      categoryName: name,
      loadMs: this.deps.now() - started,
    };
  }

  classify(samples: Float32Array): { score: number; inferenceMs: number } {
    if (!this.classifier) throw new CryEngineError('classifier_failed', 'not loaded');
    const started = this.deps.now();
    const results = this.classifier.classify(samples, YAMNET_SAMPLE_RATE);
    return { score: scoreOf(results, this.categoryIndex), inferenceMs: this.deps.now() - started };
  }

  dispose(): void {
    this.classifier?.close();
    this.classifier = null;
  }
}
