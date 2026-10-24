/** Messages between capture.ts (main thread) and captureWorklet.ts (audio thread). */

export const CAPTURE_PROCESSOR = 'lotties-cry-capture';

/** Messages from the processor. */
export interface WorkletFrameMessage {
  type: 'frame';
  index: number;
  samples: Float32Array;
  /** Frames dropped so far because every buffer was out (the classifier is behind). */
  dropped: number;
}

/** Messages to the processor. */
export type WorkletInMessage = { type: 'release'; samples: Float32Array } | { type: 'stop' };
