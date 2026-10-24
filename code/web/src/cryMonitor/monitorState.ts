import type { CryEngineErrorCode } from '../cry/errors';

/*
 * The cry monitor page as a pure state machine (docs/design/35-cry-engine.md section 8):
 *
 *   intro --start (no consent)--> consent --agree--> intro --start--> loading --> listening
 *     ^                                                                  |            |
 *     +------------------------------ stop / cancel ---------------------+------------+
 *   loading | listening --engine error / stall--> failure --retry--> loading
 *
 * `unsupported` is a failure the page starts in when the browser lacks what the engine needs. The
 * page never claims to listen outside `listening`: a stall (no audio frames, the screen went off or
 * another app came to the front) ends it like an error.
 */

/** What went wrong, as the page explains it (each with one action). */
export type MonitorFailure =
  /** The person or the browser refused the microphone. */
  | 'denied'
  /** No microphone, or it is busy. */
  | 'unavailable'
  /** The microphone stopped while listening (a call, another app, the permission revoked). */
  | 'lost'
  /** No sound reached the monitor for a while (screen off, page in the background): it stopped. */
  | 'stalled'
  /** The model could not load or the classifier failed: "not available right now". */
  | 'model'
  /** This browser cannot run it (no microphone API, AudioWorklet, WebAssembly or workers, or no HTTPS). */
  | 'unsupported';

export type MonitorState =
  | { phase: 'intro' }
  | { phase: 'consent' }
  | { phase: 'loading' }
  | { phase: 'listening'; since: number }
  | { phase: 'failure'; failure: MonitorFailure; at: number | null };

export type MonitorAction =
  /** "Start monitoring" without a current consent on this device. */
  | { type: 'consentNeeded' }
  | { type: 'consentGiven' }
  | { type: 'consentCancelled' }
  /** "Start monitoring" (or retry) with consent: the engine loads. */
  | { type: 'start' }
  | { type: 'listening'; at: number }
  | { type: 'error'; code: CryEngineErrorCode; at: number }
  | { type: 'stalled'; at: number }
  /** Stop, cancel while loading, or leave a failure. */
  | { type: 'stop' };

/** The failure the page shows for an engine error code. */
export function failureOf(code: CryEngineErrorCode): MonitorFailure {
  switch (code) {
    case 'denied':
      return 'denied';
    case 'unavailable':
      return 'unavailable';
    case 'lost':
      return 'lost';
    case 'insecure_context':
    case 'unsupported':
      return 'unsupported';
    case 'model_missing':
    case 'model_invalid':
    case 'class_missing':
    case 'classifier_failed':
      return 'model';
  }
}

export function initialMonitorState(supported: boolean): MonitorState {
  return supported ? { phase: 'intro' } : { phase: 'failure', failure: 'unsupported', at: null };
}

const isRunning = (state: MonitorState) => state.phase === 'loading' || state.phase === 'listening';

export function monitorReducer(state: MonitorState, action: MonitorAction): MonitorState {
  // Nothing leaves "not supported on this device".
  if (state.phase === 'failure' && state.failure === 'unsupported') return state;
  switch (action.type) {
    case 'consentNeeded':
      return state.phase === 'intro' || state.phase === 'failure' ? { phase: 'consent' } : state;
    case 'consentGiven':
    case 'consentCancelled':
      return state.phase === 'consent' ? { phase: 'intro' } : state;
    case 'start':
      return state.phase === 'intro' || state.phase === 'failure' ? { phase: 'loading' } : state;
    case 'listening':
      return state.phase === 'loading' ? { phase: 'listening', since: action.at } : state;
    case 'error':
      return isRunning(state)
        ? { phase: 'failure', failure: failureOf(action.code), at: action.at }
        : state;
    case 'stalled':
      return state.phase === 'listening'
        ? { phase: 'failure', failure: 'stalled', at: action.at }
        : state;
    case 'stop':
      return state.phase === 'consent' ? state : { phase: 'intro' };
  }
}
