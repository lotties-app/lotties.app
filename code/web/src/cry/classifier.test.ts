import { describe, expect, it } from 'vitest';
import { WorkerClassifier, type WorkerLike } from './classifier';
import type { ClassifierRequest, ClassifierResponse } from './classifierProtocol';
import { CRY_MODEL_SHA256, cryAssetUrls } from './modelAssets';

/* The main-thread side of the worker protocol, with a fake worker. */

class FakeWorker implements WorkerLike {
  sent: { message: ClassifierRequest; transfer?: Transferable[] }[] = [];
  onmessage: ((event: MessageEvent<ClassifierResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  terminated = false;
  postMessage(message: ClassifierRequest, transfer?: Transferable[]) {
    this.sent.push({ message, transfer });
  }
  terminate() {
    this.terminated = true;
  }
  reply(response: ClassifierResponse) {
    this.onmessage?.({ data: response } as MessageEvent<ClassifierResponse>);
  }
  last() {
    return this.sent[this.sent.length - 1].message;
  }
}

const assets = cryAssetUrls('https://lotties.test/');

function setup() {
  const worker = new FakeWorker();
  let created = 0;
  const classifier = new WorkerClassifier({
    assets,
    createWorker: () => {
      created++;
      return worker;
    },
  });
  return { worker, classifier, created: () => created };
}

describe('WorkerClassifier', () => {
  it('asks the worker to load the self-hosted model and WASM with the pinned checksum', async () => {
    const { worker, classifier } = setup();
    const loading = classifier.load();
    expect(worker.last()).toEqual({
      type: 'load',
      id: 1,
      modelUrl: 'https://lotties.test/models/cry/yamnet.tflite',
      modelSha256: CRY_MODEL_SHA256,
      wasmLoaderUrl: 'https://lotties.test/models/cry/wasm/audio_wasm_module_internal.js',
      wasmBinaryUrl: 'https://lotties.test/models/cry/wasm/audio_wasm_module_internal.wasm',
    });
    worker.reply({
      type: 'loaded',
      id: 1,
      categoryIndex: 20,
      categoryName: 'Baby cry, infant cry',
      loadMs: 190,
    });
    await expect(loading).resolves.toEqual({
      categoryIndex: 20,
      categoryName: 'Baby cry, infant cry',
      loadMs: 190,
    });
  });

  it('turns an error reply into a typed error', async () => {
    const { worker, classifier } = setup();
    const loading = classifier.load();
    worker.reply({ type: 'error', id: 1, code: 'model_missing', message: 'HTTP 404' });
    await expect(loading).rejects.toMatchObject({ name: 'CryEngineError', code: 'model_missing' });
  });

  it('transfers each frame and gets it back with its score', async () => {
    const { worker, classifier } = setup();
    const samples = new Float32Array(15600);
    const scoring = classifier.classify(samples);
    const sent = worker.sent[0];
    expect(sent.message).toEqual({ type: 'classify', id: 1, samples });
    expect(sent.transfer).toEqual([samples.buffer]);
    worker.reply({ type: 'result', id: 1, score: 0.04, inferenceMs: 4.5, samples });
    await expect(scoring).resolves.toEqual({ score: 0.04, inferenceMs: 4.5, samples });
  });

  it('dispose() closes and terminates the worker and rejects what is pending', async () => {
    const { worker, classifier, created } = setup();
    const pending = classifier.classify(new Float32Array(15600));
    classifier.dispose();
    await expect(pending).rejects.toMatchObject({ code: 'classifier_failed' });
    expect(worker.last()).toEqual({ type: 'dispose' });
    expect(worker.terminated).toBe(true);
    expect(worker.onmessage).toBeNull();
    await expect(classifier.load()).rejects.toMatchObject({ code: 'classifier_failed' });
    classifier.dispose();
    expect(created()).toBe(1);
  });

  it('a crashing worker rejects what is pending', async () => {
    const { worker, classifier } = setup();
    const pending = classifier.load();
    worker.onerror?.({ message: 'wasm trap', preventDefault: () => {} } as ErrorEvent);
    await expect(pending).rejects.toMatchObject({
      code: 'classifier_failed',
      message: 'wasm trap',
    });
  });
});
