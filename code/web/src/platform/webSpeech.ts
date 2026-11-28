import {
  SpeechError,
  type ListenRequest,
  type ListenResult,
  type ListenState,
  type SpeechEngine,
  type SpeechErrorCode,
} from './speechTypes';

/*
 * The `web` speech engine: the WebView's or browser's own `SpeechRecognition` (prefixed
 * `webkitSpeechRecognition` in Safari, WKWebView and Chrome). Where its audio goes is up to the browser
 * (Apple's or Google's speech service, maybe on the device): the voice lab says so before it is used.
 * One recognition at a time, released on every way out (result, error, cancel, timeout).
 */

interface RecognitionAlternative {
  transcript: string;
  confidence: number;
}

interface RecognitionResultEvent {
  results: ArrayLike<ArrayLike<RecognitionAlternative> & { isFinal?: boolean }>;
}

interface RecognitionErrorEvent {
  error?: string;
}

/** The part of `SpeechRecognition` this engine uses (not in TypeScript's DOM library). */
export interface RecognitionLike {
  lang: string;
  maxAlternatives: number;
  interimResults: boolean;
  continuous: boolean;
  onaudiostart: (() => void) | null;
  onspeechstart: (() => void) | null;
  onspeechend: (() => void) | null;
  onresult: ((event: RecognitionResultEvent) => void) | null;
  onnomatch: (() => void) | null;
  onerror: ((event: RecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  abort(): void;
}

export type RecognitionConstructor = new () => RecognitionLike;

/** The browser's recogniser class, or null where there is none. */
export function webSpeechConstructor(scope: object = globalThis): RecognitionConstructor | null {
  const holder = scope as {
    SpeechRecognition?: RecognitionConstructor;
    webkitSpeechRecognition?: RecognitionConstructor;
  };
  try {
    return holder.SpeechRecognition ?? holder.webkitSpeechRecognition ?? null;
  } catch {
    return null;
  }
}

const ERRORS: Readonly<Record<string, SpeechErrorCode>> = {
  'no-speech': 'speech_timeout',
  aborted: 'cancelled',
  'audio-capture': 'audio',
  network: 'network',
  'not-allowed': 'denied',
  'service-not-allowed': 'denied',
  'language-not-supported': 'language_unavailable',
};

const errorCode = (name: string | undefined): SpeechErrorCode =>
  name !== undefined && Object.hasOwn(ERRORS, name) ? ERRORS[name] : 'recognizer_error';

export function createWebSpeechEngine(
  Recognition: RecognitionConstructor,
  now: () => number = Date.now,
): SpeechEngine {
  let active: { recognition: RecognitionLike; fail: (code: SpeechErrorCode) => void } | null = null;

  function listen(request: ListenRequest, onState: (state: ListenState) => void) {
    if (active) return Promise.reject(new SpeechError('busy'));
    return new Promise<ListenResult>((resolve, reject) => {
      let recognition: RecognitionLike;
      try {
        recognition = new Recognition();
      } catch {
        reject(new SpeechError('not_available'));
        return;
      }
      const startedAt = now();
      let endOfSpeechAt: number | null = null;
      let settled = false;

      const release = () => {
        clearTimeout(timer);
        recognition.onaudiostart = null;
        recognition.onspeechstart = null;
        recognition.onspeechend = null;
        recognition.onresult = null;
        recognition.onnomatch = null;
        recognition.onerror = null;
        recognition.onend = null;
        if (active?.recognition === recognition) active = null;
      };
      const fail = (code: SpeechErrorCode) => {
        if (settled) return;
        settled = true;
        release();
        try {
          recognition.abort();
        } catch {
          // already stopped
        }
        reject(new SpeechError(code));
      };

      recognition.lang = request.locale;
      recognition.maxAlternatives = request.maxResults;
      recognition.interimResults = false;
      recognition.continuous = false;
      recognition.onaudiostart = () => onState('ready');
      recognition.onspeechstart = () => onState('speech');
      recognition.onspeechend = () => {
        endOfSpeechAt = now();
        onState('processing');
      };
      recognition.onresult = (event) => {
        if (settled) return;
        const first = event.results[0];
        const items = first ? Array.from({ length: first.length }, (_, i) => first[i]) : [];
        const alternatives = items.map((item) => item.transcript ?? '');
        settled = true;
        release();
        resolve({
          alternatives,
          confidences: items.map((item) =>
            typeof item.confidence === 'number' && item.confidence > 0 ? item.confidence : null,
          ),
          startedAt,
          endOfSpeechAt,
          resultAt: now(),
          onDevice: null,
        });
      };
      recognition.onnomatch = () => fail('no_match');
      recognition.onerror = (event) => fail(errorCode(event.error));
      recognition.onend = () => fail('no_match');
      const timer = setTimeout(() => fail('timeout'), request.timeoutMs);
      active = { recognition, fail };
      onState('starting');
      try {
        recognition.start();
      } catch {
        fail('busy');
      }
    });
  }

  return {
    kind: 'web',
    listen,
    async cancel() {
      active?.fail('cancelled');
    },
  };
}
