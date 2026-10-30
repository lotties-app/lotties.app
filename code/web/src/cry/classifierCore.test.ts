import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  checkedModelBytes,
  ClassifierService,
  CRY_CLASS_NAME,
  isTfliteModel,
  resolveCategoryIndex,
  scoreOf,
  wasmSimdSupported,
  type AudioClassifierLike,
  type ClassificationResultLike,
  type ServiceDeps,
} from './classifierCore';

/* The classifier logic without MediaPipe: label map by name, model checks, the load/classify/close cycle. */

const result = (...categories: [number, string, number][]): ClassificationResultLike[] => [
  {
    classifications: [
      {
        categories: categories.map(([index, categoryName, score]) => ({
          index,
          categoryName,
          score,
        })),
      },
    ],
  },
];

/** A label map where the cry class is NOT at YAMNet's index 20: resolution must go by name. */
const LABELS = result([0, 'Speech', 0.6], [42, CRY_CLASS_NAME, 0.25], [20, 'Whimper', 0.1]);

function modelBytes(body = 'model'): Uint8Array {
  const bytes = new Uint8Array(16 + body.length);
  bytes.set([0x1c, 0, 0, 0, 0x54, 0x46, 0x4c, 0x33]);
  bytes.set(new TextEncoder().encode(body), 16);
  return bytes;
}
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const subtle = globalThis.crypto.subtle;

function response(bytes: Uint8Array | string, status = 200, type = 'application/octet-stream') {
  const body = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes;
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': type }),
    arrayBuffer: async () => body.slice().buffer,
  };
}

describe('label map', () => {
  it('resolves the cry class by name, wherever it sits', () => {
    expect(resolveCategoryIndex(LABELS)).toBe(42);
    expect(scoreOf(LABELS, 42)).toBe(0.25);
    expect(scoreOf(LABELS, 7)).toBe(0);
  });

  it('fails loudly with class_missing when the model has no such class', () => {
    expect(() => resolveCategoryIndex(result([20, 'Whimper', 1]))).toThrow(
      expect.objectContaining({ code: 'class_missing' }),
    );
    expect(() => resolveCategoryIndex([])).toThrow(
      expect.objectContaining({ code: 'class_missing' }),
    );
  });
});

describe('model checks', () => {
  it('accepts the pinned TFLite file', async () => {
    const bytes = modelBytes();
    expect(isTfliteModel(bytes)).toBe(true);
    await expect(checkedModelBytes(response(bytes), sha(bytes), subtle)).resolves.toEqual(bytes);
  });

  it('a 404 or the SPA fallback page is model_missing', async () => {
    await expect(checkedModelBytes(response('', 404), 'x', subtle)).rejects.toMatchObject({
      code: 'model_missing',
    });
    await expect(
      checkedModelBytes(response('<!doctype html>', 200, 'text/html; charset=utf-8'), 'x', subtle),
    ).rejects.toMatchObject({ code: 'model_missing' });
  });

  it('another file or another model is model_invalid', async () => {
    await expect(
      checkedModelBytes(response('not a model at all'), 'x', subtle),
    ).rejects.toMatchObject({
      code: 'model_invalid',
    });
    await expect(
      checkedModelBytes(response(modelBytes('a')), sha(modelBytes('b')), subtle),
    ).rejects.toMatchObject({ code: 'model_invalid' });
  });

  it('detects WebAssembly SIMD', () => {
    expect(wasmSimdSupported()).toBe(true); // Node 22 has SIMD
    expect(wasmSimdSupported(undefined as unknown as typeof WebAssembly)).toBe(true);
    expect(wasmSimdSupported({ validate: () => false } as unknown as typeof WebAssembly)).toBe(
      false,
    );
  });
});

describe('ClassifierService', () => {
  const bytes = modelBytes();
  const request = {
    modelUrl: '/models/cry/yamnet.tflite',
    modelSha256: sha(bytes),
    wasmLoaderUrl: '/models/cry/wasm/loader.js',
    wasmBinaryUrl: '/models/cry/wasm/binary.wasm',
  };

  function deps(classifier: AudioClassifierLike, overrides: Partial<ServiceDeps> = {}) {
    const createFromOptions = vi.fn(async () => classifier);
    let t = 0;
    const d: ServiceDeps = {
      loadTasks: async () => ({ AudioClassifier: { createFromOptions } }),
      fetch: vi.fn(async () => response(bytes)),
      subtle,
      now: () => (t += 4.5),
      ...overrides,
    };
    return { d, createFromOptions };
  }

  it('loads from its own files, resolves the class and scores frames', async () => {
    const classifier = { classify: vi.fn(() => LABELS), close: vi.fn() };
    const { d, createFromOptions } = deps(classifier);
    const service = new ClassifierService(d);
    await expect(service.load(request)).resolves.toEqual({
      categoryIndex: 42,
      categoryName: CRY_CLASS_NAME,
      loadMs: 4.5,
    });
    expect(d.fetch).toHaveBeenCalledWith('/models/cry/yamnet.tflite');
    expect(createFromOptions).toHaveBeenCalledWith(
      { wasmLoaderPath: request.wasmLoaderUrl, wasmBinaryPath: request.wasmBinaryUrl },
      { baseOptions: { modelAssetBuffer: bytes }, maxResults: -1 },
    );
    const frame = new Float32Array(15600);
    expect(service.classify(frame)).toEqual({ score: 0.25, inferenceMs: 4.5 });
    expect(classifier.classify).toHaveBeenLastCalledWith(frame, 16000);
    service.dispose();
    expect(classifier.close).toHaveBeenCalled();
    expect(() => service.classify(frame)).toThrow(
      expect.objectContaining({ code: 'classifier_failed' }),
    );
  });

  it('closes the classifier and fails with class_missing when the label is absent', async () => {
    const classifier = { classify: vi.fn(() => result([20, 'Whimper', 1])), close: vi.fn() };
    const service = new ClassifierService(deps(classifier).d);
    await expect(service.load(request)).rejects.toMatchObject({ code: 'class_missing' });
    expect(classifier.close).toHaveBeenCalled();
  });

  it('a failed download is model_missing; no SIMD is unsupported', async () => {
    const classifier = { classify: vi.fn(() => LABELS), close: vi.fn() };
    const offline = deps(classifier, {
      fetch: async () => Promise.reject(new TypeError('offline')),
    });
    await expect(new ClassifierService(offline.d).load(request)).rejects.toMatchObject({
      code: 'model_missing',
    });
    const old = deps(classifier, {
      wasm: { validate: () => false } as unknown as typeof WebAssembly,
    });
    await expect(new ClassifierService(old.d).load(request)).rejects.toMatchObject({
      code: 'unsupported',
    });
    expect(old.createFromOptions).not.toHaveBeenCalled();
  });
});
