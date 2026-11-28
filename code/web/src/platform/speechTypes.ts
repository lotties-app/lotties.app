/*
 * Types of the speech engines (platform/speech.ts, platform/webSpeech.ts): kept apart so both import
 * them without an import cycle.
 */

export type SpeechEngineKind = 'on_device' | 'server' | 'web';

export const SPEECH_ENGINES: readonly SpeechEngineKind[] = ['on_device', 'server', 'web'];

export type SpeechErrorCode =
  | 'denied'
  | 'no_match'
  | 'speech_timeout'
  | 'language_unavailable'
  | 'on_device_unavailable'
  | 'not_available'
  | 'busy'
  | 'network'
  | 'audio'
  | 'interrupted'
  | 'cancelled'
  | 'timeout'
  | 'not_supported'
  | 'recognizer_error';

const ERROR_CODES: ReadonlySet<string> = new Set<SpeechErrorCode>([
  'denied',
  'no_match',
  'speech_timeout',
  'language_unavailable',
  'on_device_unavailable',
  'not_available',
  'busy',
  'network',
  'audio',
  'interrupted',
  'cancelled',
  'timeout',
  'not_supported',
  'recognizer_error',
]);

export class SpeechError extends Error {
  readonly code: SpeechErrorCode;

  constructor(code: SpeechErrorCode, message: string = code) {
    super(message);
    this.name = 'SpeechError';
    this.code = code;
  }
}

/** An error from a plugin call or anything else, as a speech error code. */
export function speechErrorCode(error: unknown): SpeechErrorCode {
  if (error instanceof SpeechError) return error.code;
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && ERROR_CODES.has(code)
    ? (code as SpeechErrorCode)
    : 'recognizer_error';
}

/** `not_needed`: Android has no separate speech recognition permission. */
export type PermissionStatus =
  'granted' | 'denied' | 'prompt' | 'restricted' | 'not_needed' | 'unknown';

/** What the phone (or browser) reports, without asking for any permission. */
export interface SpeechCapabilities {
  platform: 'android' | 'ios' | 'web';
  osVersion: string | null;
  /** A recogniser exists at all (server or on-device). */
  recognitionAvailable: boolean | null;
  /** The phone has an on-device recogniser for this language (null: cannot tell). */
  onDeviceAvailable: boolean | null;
  /** Why not, as the plugin names it (`api_below_31`, `locale_unsupported`, ...). */
  onDeviceReason: string | null;
  languageInstalled: boolean | null;
  languageDownloadable: boolean | null;
  languagePending: boolean | null;
  /** The language download can be started from the app (Android 13+). */
  canDownload: boolean;
  /** The recogniser takes the hint phrases (Android 13+, iOS). */
  biasing: boolean | null;
  microphone: PermissionStatus;
  speech: PermissionStatus;
  /** `webkitSpeechRecognition` (or `SpeechRecognition`) exists in this WebView. */
  webSpeech: boolean;
}

export type ListenState = 'starting' | 'ready' | 'speech' | 'processing';

export interface ListenRequest {
  locale: string;
  /** Short phrases the recogniser should favour (iOS takes at most 100). */
  hints: readonly string[];
  maxResults: number;
  /** The engine gives up after this long (no speech, no answer). */
  timeoutMs: number;
}

export interface ListenResult {
  /** Best first. */
  alternatives: string[];
  /** One per alternative, 0-1, null when the engine gives none. */
  confidences: (number | null)[];
  /** Epoch ms on the engine's clock. */
  startedAt: number;
  /** When the engine decided the speech ended (null: it did not say). */
  endOfSpeechAt: number | null;
  resultAt: number;
  /** Whether the engine ran on the device (null: not known, the web engine). */
  onDevice: boolean | null;
}

export interface SpeechEngine {
  readonly kind: SpeechEngineKind;
  listen(request: ListenRequest, onState: (state: ListenState) => void): Promise<ListenResult>;
  /** Stops listening and releases the microphone; the pending listen rejects with `cancelled`. */
  cancel(): Promise<void>;
}

export type DownloadStatus = 'started' | 'scheduled' | 'success' | 'unsupported' | 'error';

export interface SpeechPlatform {
  capabilities(locale: string): Promise<SpeechCapabilities>;
  /** Asks the phone to download the on-device model of `locale` (Android 13+). */
  downloadModel(locale: string): Promise<DownloadStatus>;
  /** The engine of `kind`, or null when this platform has none (no plugin in a browser). */
  engine(kind: SpeechEngineKind): SpeechEngine | null;
}
