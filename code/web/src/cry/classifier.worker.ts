/**
 * Dedicated worker of the cry monitor: runs MediaPipe Tasks Audio (YAMNet, WASM) off the main thread
 * (docs/design/35-cry-engine.md). The only module of the app that imports `@mediapipe/tasks-audio`; it is built as
 * its own chunk and loaded only when monitor mode starts. Model and WASM come from the app's own origin
 * (/models/cry/), never a CDN. Each frame comes in as a transferred buffer and goes back the same way: no sample
 * is kept, stored or sent anywhere else.
 */
import * as tasks from '@mediapipe/tasks-audio';
import { ClassifierService, type AudioTasksLike } from './classifierCore';
import type { ClassifierRequest, ClassifierResponse } from './classifierProtocol';
import { errorCodeOf } from './errors';

/** The DedicatedWorkerGlobalScope members used here (the app's tsconfig has the DOM lib, not WebWorker). */
interface WorkerScope {
  onmessage: ((event: MessageEvent<ClassifierRequest>) => void) | null;
  postMessage(message: ClassifierResponse, transfer: Transferable[]): void;
  close(): void;
}
const scope = self as unknown as WorkerScope;

const service = new ClassifierService({
  loadTasks: async () => tasks as unknown as AudioTasksLike,
  fetch: (url) => fetch(url, { credentials: 'same-origin' }),
  subtle: crypto.subtle,
  now: () => performance.now(),
});

const reply = (message: ClassifierResponse, transfer: Transferable[] = []) =>
  scope.postMessage(message, transfer);

scope.onmessage = async (event: MessageEvent<ClassifierRequest>) => {
  const request = event.data;
  if (request.type === 'dispose') {
    service.dispose();
    scope.close();
    return;
  }
  if (request.type === 'load') {
    try {
      const info = await service.load(request);
      reply({ type: 'loaded', id: request.id, ...info });
    } catch (error) {
      reply({ type: 'error', id: request.id, code: errorCodeOf(error), message: String(error) });
    }
    return;
  }
  const { id, samples } = request;
  try {
    const { score, inferenceMs } = service.classify(samples);
    reply({ type: 'result', id, score, inferenceMs, samples }, [samples.buffer]);
  } catch (error) {
    reply({ type: 'error', id, code: errorCodeOf(error), message: String(error), samples }, [
      samples.buffer,
    ]);
  }
};
