/**
 * Public API of the cry engine (docs/design/35-cry-engine.md). Import from here, ideally from a lazily loaded page:
 * the microphone capture and the classifier are loaded on demand when `createCryEngine` starts, and MediaPipe only
 * ever runs inside the classifier worker's own chunk.
 */
import { CryEngine, type CryEngineDeps } from './engine';

export { CryEngine, STALL_AFTER_MS, systemScheduler } from './engine';
export type {
  CryEngineDeps,
  CryEngineEventMap,
  CryEngineEventType,
  CryEngineStartOptions,
  CryEngineState,
  CryEngineStats,
  Scheduler,
} from './engine';
export { CryEngineError, type CryEngineErrorCode } from './errors';
export {
  CRY_SAFE_BAND,
  CRY_SENSITIVITY_THRESHOLDS,
  cryTriggerConfig,
  DEFAULT_CRY_SENSITIVITY,
  type CrySensitivity,
} from './sensitivity';
export {
  CryTrigger,
  DEFAULT_CRY_TRIGGER,
  YAMNET_HOP_MS,
  type CryTriggerConfig,
  type CryTriggerEvent,
  type ScoreFrame,
} from './trigger';
export type {
  AudioFrame,
  AudioSource,
  AudioSourceHandlers,
  CaptureInfo,
  ProcessingName,
} from './capture';
export type { Classifier, ClassifiedFrame } from './classifier';
export type { LoadedInfo } from './classifierCore';

/** The engine with the real microphone and the MediaPipe worker, both imported only when it starts. */
export function createCryEngine(overrides: Partial<CryEngineDeps> = {}): CryEngine {
  return new CryEngine({
    createSource: async () => new (await import('./capture')).MicrophoneSource(),
    createClassifier: async () => new (await import('./classifier')).WorkerClassifier(),
    ...overrides,
  });
}
