/** Messages between classifier.ts (main thread) and classifier.worker.ts. */
import type { CryEngineErrorCode } from './errors';
import type { LoadedInfo, LoadRequest } from './classifierCore';

export type ClassifierRequest =
  | ({ type: 'load'; id: number } & LoadRequest)
  | { type: 'classify'; id: number; samples: Float32Array }
  | { type: 'dispose' };

export type ClassifierResponse =
  | ({ type: 'loaded'; id: number } & LoadedInfo)
  | { type: 'result'; id: number; score: number; inferenceMs: number; samples: Float32Array }
  | {
      type: 'error';
      id: number;
      code: CryEngineErrorCode;
      message: string;
      /** The frame of a failed classify, given back. */
      samples?: Float32Array;
    };
