/**
 * Typed failures of the cry engine (docs/design/35-cry-engine.md). The monitor page (CD3) maps each code to its own
 * message; nothing here is user-visible text.
 */
export type CryEngineErrorCode =
  /** The person or the browser refused the microphone. */
  | 'denied'
  /** No microphone, or it is busy or unusable. */
  | 'unavailable'
  /** Capture stopped while listening (track ended or muted: permission revoked, a call, the page hidden). */
  | 'lost'
  /** Not HTTPS / localhost: no `navigator.mediaDevices`. */
  | 'insecure_context'
  /** `yamnet.tflite` is not deployed (scripts/fetch-cry-model.mjs was not run for this build). */
  | 'model_missing'
  /** A model file exists but is not the pinned one (checksum or format). */
  | 'model_invalid'
  /** The model's label map has no "Baby cry, infant cry" class. */
  | 'class_missing'
  /** No Web Worker, AudioWorklet or WebAssembly SIMD in this browser. */
  | 'unsupported'
  /** The classifier crashed or answered with an error. */
  | 'classifier_failed';

export class CryEngineError extends Error {
  readonly code: CryEngineErrorCode;

  constructor(code: CryEngineErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'CryEngineError';
    this.code = code;
  }
}

/** The code of a thrown value; anything that is not a CryEngineError counts as `fallback`. */
export function errorCodeOf(
  error: unknown,
  fallback: CryEngineErrorCode = 'classifier_failed',
): CryEngineErrorCode {
  return error instanceof CryEngineError ? error.code : fallback;
}
