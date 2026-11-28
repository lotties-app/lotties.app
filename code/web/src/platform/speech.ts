import { isNativeApp, nativePlatform } from './nativeApp';
import {
  SpeechError,
  speechErrorCode,
  type ListenState,
  type PermissionStatus,
  type SpeechEngine,
  type SpeechPlatform,
} from './speechTypes';
import { createWebSpeechEngine, webSpeechConstructor } from './webSpeech';

export * from './speechTypes';

/*
 * Speech recognition for the voice lab spike (docs/design/49a-voice-lab.md; design 49 sections 3.2 and
 * 7.2), later the hands-free mode. Three engines, always chosen explicitly, never swapped behind the
 * caller's back:
 * - `on_device`: the phone's own recogniser in on-device mode (local plugin `LottiesSpeech`, Kotlin and
 *   Swift in code/mobile). When the phone cannot recognise this language on the device, it fails with
 *   `on_device_unavailable` or `language_unavailable`: it never falls back to a server.
 * - `server`: the same recogniser allowed to use Google's or Apple's servers.
 * - `web`: the WebView's `webkitSpeechRecognition` where it exists; where the audio goes is not known
 *   (Apple's or Google's speech service).
 * `@capacitor/core` loads on first use (dynamic import), so a browser never downloads it. The text that
 * comes back is handed to the caller and kept nowhere here: never logged, stored or sent.
 */

/* ---- The native plugin `LottiesSpeech` (code/mobile/android/.../speech, ios/App/App/LottiesSpeechPlugin.swift). */

interface NativeCapabilities {
  platform?: string;
  osVersion?: string;
  recognitionAvailable?: boolean;
  onDeviceAvailable?: boolean;
  onDeviceReason?: string | null;
  languageInstalled?: boolean | null;
  languageDownloadable?: boolean | null;
  languagePending?: boolean | null;
  canDownload?: boolean;
  biasing?: boolean;
  microphonePermission?: string;
  speechPermission?: string;
}

interface NativeListenResult {
  alternatives?: string[];
  confidences?: (number | null)[];
  startedAt?: number;
  endOfSpeechAt?: number | null;
  resultAt?: number;
  onDevice?: boolean;
}

interface ListenerHandle {
  remove(): Promise<void>;
}

export interface LottiesSpeechPlugin {
  capabilities(options: { locale: string }): Promise<NativeCapabilities>;
  listenOnce(options: {
    locale: string;
    onDevice: boolean;
    hints: string[];
    maxResults: number;
    timeoutMs: number;
  }): Promise<NativeListenResult>;
  cancel(): Promise<void>;
  downloadModel(options: { locale: string }): Promise<{ status?: string }>;
  addListener(
    eventName: 'speechState',
    listener: (event: { state?: string }) => void,
  ): Promise<ListenerHandle>;
}

/** In an object: a promise resolving with Capacitor's proxy would read its `then` (androidVoiceBridge.ts). */
interface Loaded {
  native: LottiesSpeechPlugin;
}

let plugin: Promise<Loaded> | undefined;

function loadPlugin(): Promise<Loaded> {
  plugin ??= import('@capacitor/core').then(({ registerPlugin }) => ({
    native: registerPlugin<LottiesSpeechPlugin>('LottiesSpeech'),
  }));
  return plugin;
}

/** Test seam: the next calls use `fake` (null goes back to the real plugin). */
export function setSpeechPluginForTests(fake: LottiesSpeechPlugin | null): void {
  plugin = fake ? Promise.resolve({ native: fake }) : undefined;
}

const CALL_TIMEOUT_MS = 8000;
/** A listen may take the engine's own timeout; past that plus this margin the call is dead. */
const LISTEN_MARGIN_MS = 5000;

async function withTimeout<T>(run: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new SpeechError('timeout')), timeoutMs);
  });
  try {
    return await Promise.race([run, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

const LISTEN_STATES: ReadonlySet<string> = new Set<ListenState>(['ready', 'speech', 'processing']);
const PERMISSIONS: ReadonlySet<string> = new Set<PermissionStatus>([
  'granted',
  'denied',
  'prompt',
  'restricted',
  'not_needed',
]);
const permission = (value: string | undefined): PermissionStatus =>
  value !== undefined && PERMISSIONS.has(value) ? (value as PermissionStatus) : 'unknown';
const flag = (value: boolean | null | undefined): boolean | null =>
  typeof value === 'boolean' ? value : null;

function nativeEngine(kind: 'on_device' | 'server'): SpeechEngine {
  return {
    kind,
    async listen(request, onState) {
      const { native } = await loadPlugin();
      onState('starting');
      const handle = await native.addListener('speechState', (event) => {
        if (event.state !== undefined && LISTEN_STATES.has(event.state)) {
          onState(event.state as ListenState);
        }
      });
      try {
        const answer = await withTimeout(
          native.listenOnce({
            locale: request.locale,
            onDevice: kind === 'on_device',
            hints: [...request.hints],
            maxResults: request.maxResults,
            timeoutMs: request.timeoutMs,
          }),
          request.timeoutMs + LISTEN_MARGIN_MS,
        );
        const alternatives = (answer.alternatives ?? []).filter((a) => typeof a === 'string');
        return {
          alternatives,
          confidences: alternatives.map((_, i) => {
            const value = answer.confidences?.[i];
            return typeof value === 'number' && value >= 0 ? value : null;
          }),
          startedAt: answer.startedAt ?? Date.now(),
          endOfSpeechAt: typeof answer.endOfSpeechAt === 'number' ? answer.endOfSpeechAt : null,
          resultAt: answer.resultAt ?? Date.now(),
          onDevice: answer.onDevice ?? kind === 'on_device',
        };
      } catch (error) {
        if (speechErrorCode(error) === 'timeout') await native.cancel().catch(() => undefined);
        throw new SpeechError(speechErrorCode(error));
      } finally {
        await handle.remove().catch(() => undefined);
      }
    },
    async cancel() {
      const { native } = await loadPlugin();
      await withTimeout(native.cancel(), CALL_TIMEOUT_MS).catch(() => undefined);
    },
  };
}

function nativePlatformSpeech(platformName: 'android' | 'ios'): SpeechPlatform {
  const engines = {
    on_device: nativeEngine('on_device'),
    server: nativeEngine('server'),
  } as const;
  const web = webSpeechConstructor();
  const webEngine = web ? createWebSpeechEngine(web) : null;
  return {
    async capabilities(locale) {
      const { native } = await loadPlugin();
      const c = await withTimeout(native.capabilities({ locale }), CALL_TIMEOUT_MS);
      return {
        platform: platformName,
        osVersion: c.osVersion ?? null,
        recognitionAvailable: flag(c.recognitionAvailable),
        onDeviceAvailable: flag(c.onDeviceAvailable),
        onDeviceReason: c.onDeviceReason ?? null,
        languageInstalled: flag(c.languageInstalled),
        languageDownloadable: flag(c.languageDownloadable),
        languagePending: flag(c.languagePending),
        canDownload: c.canDownload === true,
        biasing: flag(c.biasing),
        microphone: permission(c.microphonePermission),
        speech: permission(c.speechPermission),
        webSpeech: web !== null,
      };
    },
    async downloadModel(locale) {
      const { native } = await loadPlugin();
      const { status } = await withTimeout(native.downloadModel({ locale }), CALL_TIMEOUT_MS * 8);
      return status === 'started' ||
        status === 'scheduled' ||
        status === 'success' ||
        status === 'unsupported'
        ? status
        : 'error';
    },
    engine(kind) {
      return kind === 'web' ? webEngine : engines[kind];
    },
  };
}

function browserSpeech(): SpeechPlatform {
  const web = webSpeechConstructor();
  const webEngine = web ? createWebSpeechEngine(web) : null;
  return {
    async capabilities() {
      return {
        platform: 'web',
        osVersion: null,
        recognitionAvailable: web !== null,
        onDeviceAvailable: false,
        onDeviceReason: 'no_native_app',
        languageInstalled: null,
        languageDownloadable: null,
        languagePending: null,
        canDownload: false,
        biasing: null,
        microphone: 'unknown',
        speech: 'unknown',
        webSpeech: web !== null,
      };
    },
    async downloadModel() {
      return 'unsupported';
    },
    engine(kind) {
      return kind === 'web' ? webEngine : null;
    },
  };
}

/** The speech engines of this device: the plugin inside the app, the web engine only in a browser. */
export function speechPlatform(): SpeechPlatform {
  const platformName = nativePlatform();
  return isNativeApp() && platformName ? nativePlatformSpeech(platformName) : browserSpeech();
}
