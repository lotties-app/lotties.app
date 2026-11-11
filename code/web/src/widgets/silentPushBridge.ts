import { nativePlatform } from '../platform/nativeApp';
import { loadLottiesShared, viaWebKit, webkitHandler } from './widgetBridge';

/**
 * The native side of the widgets' silent push (docs/design/37b-widget-silent-push.md section 5): whether a widget is
 * installed, this install's push token, the "something changed" ping and its answer. On iOS through the app's WebKit
 * message handler `lotties` (AppDelegate + `LottiesSilentPush.swift`); the ping arrives as the window event
 * {@link REMOTE_CHANGE_EVENT}. On Android through the `LottiesShared` Capacitor plugin (`LottiesSharedPlugin.kt`: the
 * same three methods with the FCM token, and the plugin event `remoteChange` fired for each ping
 * `push/LottiesMessagingService.kt` receives). Only meaningful when `isNativeApp()`.
 */
export interface SilentPushNative {
  /**
   * The push service this platform would use (`apns` on iOS, `fcm` on Android, `null` elsewhere). Read from the
   * Capacitor bridge in JavaScript: it calls nothing native, so it is safe before the server says silent push is on.
   */
  channel(): PushChannel | null;
  /** Whether at least one Lotties widget is on the home or lock screen. */
  widgetsInstalled(): Promise<boolean>;
  /** This install's push token, or `null` (no push entitlement yet, simulator, no Firebase or Play services, refused). */
  pushToken(): Promise<NativePushToken | null>;
  /** Calls `listener` on every ping; returns the stop. */
  onRemoteChange(listener: () => void): () => void;
  /** The ping was handled (iOS ends the background time it gave, Android the messaging service's wait). */
  remoteChangeDone(changed: boolean): Promise<void>;
}

export type PushChannel = 'apns' | 'fcm';

/** The body of `POST /push/devices`. */
export interface NativePushToken {
  channel: PushChannel;
  token: string;
  apnsEnvironment?: 'production' | 'sandbox';
}

/** Dispatched on `window` by the iOS app when a silent push arrives (`LottiesSilentPush.swift`). */
export const REMOTE_CHANGE_EVENT = 'lotties:remote-change';

/** iOS waits up to 10 seconds for APNs to hand over the token. */
const TOKEN_TIMEOUT_MS = 12_000;

interface SilentPushPlugin {
  widgetsInstalled(): Promise<{ installed?: boolean }>;
  pushToken(): Promise<Partial<NativePushToken>>;
  silentPushDone(options: { changed: boolean }): Promise<void>;
  addListener(
    event: 'remoteChange',
    listener: () => void,
  ): Promise<{ remove: () => Promise<void> }>;
}

/** A token the native layer reported, or `null` when it is missing or malformed. */
export function toPushToken(reply: unknown): NativePushToken | null {
  if (typeof reply !== 'object' || reply === null) return null;
  const { channel, token, apnsEnvironment } = reply as Partial<
    Record<keyof NativePushToken, unknown>
  >;
  if ((channel !== 'apns' && channel !== 'fcm') || typeof token !== 'string' || token.length === 0)
    return null;
  if (channel === 'fcm') return { channel, token };
  return apnsEnvironment === 'production' || apnsEnvironment === 'sandbox'
    ? { channel, token, apnsEnvironment }
    : null;
}

/**
 * Runs `call` on the `LottiesShared` proxy. The proxy is never the value of a promise (an async function returning it
 * would make the promise read its `then`, a native call that never answers: see widgetBridge.ts).
 */
async function withPlugin<T>(call: (plugin: SilentPushPlugin) => Promise<T>): Promise<T> {
  const loaded = await loadLottiesShared();
  return call(loaded.native as SilentPushPlugin);
}

const CHANNELS = { ios: 'apns', android: 'fcm' } as const;

export const nativeSilentPush: SilentPushNative = {
  channel: () => {
    const platform = nativePlatform();
    return platform ? CHANNELS[platform] : null;
  },
  widgetsInstalled: async () => {
    const handler = webkitHandler();
    if (handler) return (await viaWebKit(handler, 'widgetsInstalled')) === true;
    return (await withPlugin((p) => p.widgetsInstalled())).installed === true;
  },
  pushToken: async () => {
    const handler = webkitHandler();
    if (handler) return toPushToken(await viaWebKit(handler, 'pushToken', {}, TOKEN_TIMEOUT_MS));
    return toPushToken(await withPlugin((p) => p.pushToken()));
  },
  onRemoteChange: (listener) => {
    window.addEventListener(REMOTE_CHANGE_EVENT, listener);
    const handle = webkitHandler()
      ? undefined
      : withPlugin((p) => p.addListener('remoteChange', listener)).catch(() => undefined);
    return () => {
      window.removeEventListener(REMOTE_CHANGE_EVENT, listener);
      void handle?.then((registered) => registered?.remove());
    };
  },
  remoteChangeDone: async (changed) => {
    const handler = webkitHandler();
    if (handler) {
      await viaWebKit(handler, 'silentPushDone', { changed });
      return;
    }
    await withPlugin((p) => p.silentPushDone({ changed }));
  },
};
