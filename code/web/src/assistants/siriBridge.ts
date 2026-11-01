import { viaWebKit, webkitHandler } from '../widgets/widgetBridge';

/**
 * The Siri/Shortcuts connection of the iOS app (code/mobile/ios/App/App/LottiesMcp.swift): the intents call the MCP server
 * with their own OAuth sign-in (PKCE client `VITE_SIRI_CLIENT_ID`, tokens in the Keychain). Only meaningful in the native
 * iOS shell (the WebKit handler exists there); elsewhere `available()` is false.
 */
const SIGN_IN_TIMEOUT_MS = 5 * 60 * 1000;

export const siriClientId = (): string =>
  (import.meta.env.VITE_SIRI_CLIENT_ID as string | undefined)?.trim() || 'lotties-ios';

export const siriBridge = {
  available: (): boolean => webkitHandler() !== undefined,

  async status(): Promise<boolean> {
    const handler = webkitHandler();
    return handler ? (await viaWebKit(handler, 'siriStatus')) === true : false;
  },

  /** Opens the system sign-in sheet; true when connected, false when the person cancelled. */
  async connect(authority: string, mcpUrl: string): Promise<boolean> {
    const handler = webkitHandler();
    if (!handler) return false;
    const body = { authority, clientId: siriClientId(), mcpUrl };
    return (await viaWebKit(handler, 'siriConnect', body, SIGN_IN_TIMEOUT_MS)) === true;
  },

  async disconnect(): Promise<void> {
    const handler = webkitHandler();
    if (handler) await viaWebKit(handler, 'siriDisconnect');
  },
};
