/**
 * Voice on Android (docs/design/37-widgets-siri.md section 14): the `LottiesVoice` Capacitor plugin
 * (code/mobile/android/app/src/main/java/app/lotties/app/voice/LottiesVoicePlugin.kt) signs the
 * phone's voice shortcuts in to the MCP server (PKCE client `VITE_ANDROID_VOICE_CLIENT_ID`, tokens
 * encrypted with the Android Keystore). Used through `siriBridge` only on Android; `@capacitor/core`
 * loads on first use (dynamic import), so the PWA never downloads it.
 */
const SIGN_IN_TIMEOUT_MS = 5 * 60 * 1000;
const CALL_TIMEOUT_MS = 8000;

export const androidVoiceClientId = (): string =>
  (import.meta.env.VITE_ANDROID_VOICE_CLIENT_ID as string | undefined)?.trim() || 'lotties-android';

interface Connected {
  connected: boolean;
}

export interface LottiesVoicePlugin {
  status(): Promise<Connected>;
  connect(options: { authority: string; clientId: string; mcpUrl: string }): Promise<Connected>;
  disconnect(): Promise<Connected>;
}

let plugin: Promise<LottiesVoicePlugin> | undefined;

function load(): Promise<LottiesVoicePlugin> {
  plugin ??= import('@capacitor/core').then(({ registerPlugin }) =>
    registerPlugin<LottiesVoicePlugin>('LottiesVoice'),
  );
  return plugin;
}

/** Test seam: the next calls use `fake` (null goes back to the real plugin). */
export function setVoicePluginForTests(fake: LottiesVoicePlugin | null): void {
  plugin = fake ? Promise.resolve(fake) : undefined;
}

/** A native call that never answers must become an error, not a promise that hangs. */
async function call<T>(
  method: string,
  run: (p: LottiesVoicePlugin) => Promise<T>,
  timeoutMs = CALL_TIMEOUT_MS,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`no answer from the native plugin (${method})`)),
      timeoutMs,
    );
  });
  try {
    return await Promise.race([load().then(run), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export const androidVoiceBridge = {
  async status(): Promise<boolean> {
    return (await call('status', (p) => p.status())).connected === true;
  },

  /** Opens the system browser to sign in; true when connected, false when the person cancelled. */
  async connect(authority: string, mcpUrl: string): Promise<boolean> {
    const options = { authority, clientId: androidVoiceClientId(), mcpUrl };
    const answer = await call('connect', (p) => p.connect(options), SIGN_IN_TIMEOUT_MS);
    return answer.connected === true;
  },

  async disconnect(): Promise<void> {
    await call('disconnect', (p) => p.disconnect());
  },
};
