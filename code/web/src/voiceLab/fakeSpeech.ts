import {
  SpeechError,
  type ListenResult,
  type SpeechCapabilities,
  type SpeechEngine,
  type SpeechErrorCode,
  type SpeechPlatform,
} from '../platform/speechTypes';

/*
 * A scripted speech platform for tests and the /dev/voice-lab preview: no microphone, no plugin. Each
 * listen answers the next scripted reply (alternatives or an error), or never answers (`hang`) until
 * cancelled. Never imported by the lab page itself.
 */

export type FakeReply = readonly string[] | { error: SpeechErrorCode } | 'hang';

export interface FakeSpeechOptions {
  replies: readonly FakeReply[];
  capabilities?: Partial<SpeechCapabilities>;
  /** Whether there is an engine at all (a browser has none). */
  hasEngine?: boolean;
  /** Engine-reported end of speech to result, ms. */
  latencyMs?: number;
}

export const FAKE_CAPABILITIES: SpeechCapabilities = {
  platform: 'android',
  osVersion: '15 (API 35)',
  recognitionAvailable: true,
  onDeviceAvailable: true,
  onDeviceReason: null,
  languageInstalled: true,
  languageDownloadable: false,
  languagePending: false,
  canDownload: true,
  biasing: true,
  microphone: 'granted',
  speech: 'granted',
};

export interface FakeSpeech extends SpeechPlatform {
  /** Listens started. */
  calls: { locale: string; hints: readonly string[] }[];
  cancels: number;
}

export function fakeSpeech({
  replies,
  capabilities,
  hasEngine = true,
  latencyMs = 420,
}: FakeSpeechOptions): FakeSpeech {
  let next = 0;
  let pending: ((code: SpeechErrorCode) => void) | null = null;
  const platform: FakeSpeech = {
    calls: [],
    cancels: 0,
    async capabilities() {
      return { ...FAKE_CAPABILITIES, ...capabilities };
    },
    async downloadModel() {
      return 'started';
    },
    engine() {
      if (!hasEngine) return null;
      const engine: SpeechEngine = {
        kind: 'on_device',
        listen(request, onState) {
          platform.calls.push({ locale: request.locale, hints: request.hints });
          const reply = replies[next % Math.max(1, replies.length)] ?? 'hang';
          next += 1;
          onState('starting');
          onState('ready');
          return new Promise<ListenResult>((resolve, reject) => {
            pending = (code) => reject(new SpeechError(code));
            if (reply === 'hang') return;
            setTimeout(() => {
              pending = null;
              if ('error' in reply) {
                reject(new SpeechError(reply.error));
                return;
              }
              const resultAt = Date.now();
              const alternatives = [...(reply as readonly string[])];
              resolve({
                alternatives,
                confidences: alternatives.map((_, i) => (i === 0 ? 0.92 : null)),
                startedAt: resultAt - latencyMs - 1500,
                endOfSpeechAt: resultAt - latencyMs,
                resultAt,
                onDevice: true,
              });
            }, 0);
          });
        },
        async cancel() {
          platform.cancels += 1;
          pending?.('cancelled');
          pending = null;
        },
      };
      return engine;
    },
  };
  return platform;
}
