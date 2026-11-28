import {
  SpeechError,
  type ListenResult,
  type SpeechCapabilities,
  type SpeechEngine,
  type SpeechEngineKind,
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
  /** Engines this platform has (default all three). */
  engines?: readonly SpeechEngineKind[];
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
  webSpeech: false,
};

export interface FakeSpeech extends SpeechPlatform {
  /** Listens started, per engine. */
  calls: { engine: SpeechEngineKind; locale: string; hints: readonly string[] }[];
  cancels: number;
}

export function fakeSpeech({
  replies,
  capabilities,
  engines = ['on_device', 'server', 'web'],
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
    engine(kind) {
      if (!engines.includes(kind)) return null;
      const engine: SpeechEngine = {
        kind,
        listen(request, onState) {
          platform.calls.push({ engine: kind, locale: request.locale, hints: request.hints });
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
                onDevice: kind === 'on_device' ? true : kind === 'server' ? false : null,
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
