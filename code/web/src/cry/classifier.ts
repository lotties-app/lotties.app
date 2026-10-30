/**
 * Main-thread side of the cry classifier: starts the dedicated worker (classifier.worker.ts, its own chunk) and
 * speaks its protocol. Frames are transferred to the worker and come back with their score, ready for reuse.
 */
import type { ClassifierRequest, ClassifierResponse } from './classifierProtocol';
import type { LoadedInfo } from './classifierCore';
import { CryEngineError } from './errors';
import { CRY_MODEL_SHA256, cryAssetUrls, type CryAssetUrls } from './modelAssets';

export interface ClassifiedFrame {
  score: number;
  inferenceMs: number;
  /** The frame's buffer, back from the worker (give it back to the audio source). */
  samples: Float32Array;
}

/** The engine's view of a classifier: injectable so tests run without a worker or WASM. */
export interface Classifier {
  load(): Promise<LoadedInfo>;
  classify(samples: Float32Array): Promise<ClassifiedFrame>;
  dispose(): void;
}

/** The Worker members used here (a fake implements them in tests). */
export interface WorkerLike {
  postMessage(message: ClassifierRequest, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent<ClassifierResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  terminate(): void;
}

export interface WorkerClassifierOptions {
  createWorker?: () => WorkerLike;
  assets?: CryAssetUrls;
  modelSha256?: string;
}

function createClassifierWorker(): WorkerLike {
  if (typeof Worker !== 'function') throw new CryEngineError('unsupported', 'no Web Worker');
  return new Worker(new URL('./classifier.worker.ts', import.meta.url), {
    type: 'module',
    name: 'lotties-cry-classifier',
  }) as unknown as WorkerLike;
}

function defaultAssets(): CryAssetUrls {
  return cryAssetUrls(new URL(import.meta.env.BASE_URL, globalThis.location.origin));
}

interface Pending {
  resolve: (value: ClassifierResponse) => void;
  reject: (error: CryEngineError) => void;
}

export class WorkerClassifier implements Classifier {
  private readonly options: WorkerClassifierOptions;
  private worker: WorkerLike | null = null;
  private readonly pending = new Map<number, Pending>();
  private nextId = 1;
  private disposed = false;

  constructor(options: WorkerClassifierOptions = {}) {
    this.options = options;
  }

  async load(): Promise<LoadedInfo> {
    const assets = this.options.assets ?? defaultAssets();
    const worker = this.ensureWorker();
    const response = await this.request(worker, {
      type: 'load',
      id: this.nextId++,
      modelUrl: assets.model,
      modelSha256: this.options.modelSha256 ?? CRY_MODEL_SHA256,
      wasmLoaderUrl: assets.wasmLoader,
      wasmBinaryUrl: assets.wasmBinary,
    });
    if (response.type !== 'loaded') throw new CryEngineError('classifier_failed', 'bad reply');
    const { categoryIndex, categoryName, loadMs } = response;
    return { categoryIndex, categoryName, loadMs };
  }

  async classify(samples: Float32Array): Promise<ClassifiedFrame> {
    const worker = this.ensureWorker();
    const response = await this.request(worker, { type: 'classify', id: this.nextId++, samples }, [
      samples.buffer,
    ]);
    if (response.type !== 'result') throw new CryEngineError('classifier_failed', 'bad reply');
    return { score: response.score, inferenceMs: response.inferenceMs, samples: response.samples };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const worker = this.worker;
    this.worker = null;
    if (worker) {
      worker.onmessage = null;
      worker.onerror = null;
      try {
        worker.postMessage({ type: 'dispose' });
      } finally {
        worker.terminate();
      }
    }
    this.rejectAll(new CryEngineError('classifier_failed', 'disposed'));
  }

  private ensureWorker(): WorkerLike {
    if (this.disposed) throw new CryEngineError('classifier_failed', 'disposed');
    if (this.worker) return this.worker;
    const worker = (this.options.createWorker ?? createClassifierWorker)();
    worker.onmessage = (event) => this.onMessage(event.data);
    worker.onerror = (event) => {
      event.preventDefault?.();
      this.rejectAll(new CryEngineError('classifier_failed', event.message || 'worker error'));
    };
    this.worker = worker;
    return worker;
  }

  private request(
    worker: WorkerLike,
    message: Exclude<ClassifierRequest, { type: 'dispose' }>,
    transfer: Transferable[] = [],
  ): Promise<ClassifierResponse> {
    return new Promise((resolve, reject) => {
      this.pending.set(message.id, { resolve, reject });
      worker.postMessage(message, transfer);
    });
  }

  private onMessage(response: ClassifierResponse): void {
    // A failed classify stops the engine, so a frame returned with an error is not reused.
    const pending = this.pending.get(response.id);
    if (!pending) return;
    this.pending.delete(response.id);
    if (response.type === 'error')
      pending.reject(new CryEngineError(response.code, response.message));
    else pending.resolve(response);
  }

  private rejectAll(error: CryEngineError): void {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
}
