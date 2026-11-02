import { viaWebKit, webkitHandler } from '../widgets/widgetBridge';
import { nativePlatform } from '../platform/nativeApp';

/**
 * The voice connection of the native app. iOS: the Siri/Shortcuts intents
 * (code/mobile/ios/App/App/LottiesMcp.swift) call the MCP server with their own OAuth sign-in (PKCE
 * client `VITE_SIRI_CLIENT_ID`, tokens in the Keychain), through the WebKit handler. Android: the
 * voice shortcuts do the same through the `LottiesVoice` plugin (androidVoiceBridge.ts, loaded
 * lazily). Elsewhere `available()` is false and nothing is connected.
 */
const SIGN_IN_TIMEOUT_MS = 5 * 60 * 1000;

export const siriClientId = (): string =>
  (import.meta.env.VITE_SIRI_CLIENT_ID as string | undefined)?.trim() || 'lotties-ios';

/** Which voice connection this app has: Siri (iOS), Voice on Android, or none (browser). */
export type VoiceKind = 'siri' | 'android';

export function voiceKind(): VoiceKind | null {
  const platform = nativePlatform();
  if (platform === 'android') return 'android';
  return webkitHandler() !== undefined ? 'siri' : null;
}

const android = () =>
  nativePlatform() === 'android'
    ? import('./androidVoiceBridge').then((m) => m.androidVoiceBridge)
    : null;

export const siriBridge = {
  available: (): boolean => voiceKind() !== null,

  async status(): Promise<boolean> {
    const voice = android();
    if (voice) return (await voice).status();
    const handler = webkitHandler();
    return handler ? (await viaWebKit(handler, 'siriStatus')) === true : false;
  },

  /** Opens the system sign-in; true when connected, false when the person cancelled. */
  async connect(authority: string, mcpUrl: string): Promise<boolean> {
    const voice = android();
    if (voice) return (await voice).connect(authority, mcpUrl);
    const handler = webkitHandler();
    if (!handler) return false;
    const body = { authority, clientId: siriClientId(), mcpUrl };
    return (await viaWebKit(handler, 'siriConnect', body, SIGN_IN_TIMEOUT_MS)) === true;
  },

  async disconnect(): Promise<void> {
    const voice = android();
    if (voice) return (await voice).disconnect();
    const handler = webkitHandler();
    if (handler) await viaWebKit(handler, 'siriDisconnect');
  },
};
