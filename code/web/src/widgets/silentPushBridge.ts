import { loadLottiesShared, viaWebKit, webkitHandler } from './widgetBridge';

/**
 * The native side of the widgets' silent push (docs/design/37b-widget-silent-push.md section 5): whether a widget is
 * installed, this install's push token, the "something changed" ping and its answer. On iOS through the app's WebKit
 * message handler `lotties` (AppDelegate + `LottiesSilentPush.swift`); the ping arrives as the window event
 * {@link REMOTE_CHANGE_EVENT}. On Android through the `LottiesShared` Capacitor plugin (methods and the `remoteChange`
 * event are not built yet: every call fails and nothing registers). Only meaningful when `isNativeApp()`.
 */
export interface SilentPushNative {
  /** Whether at least one Lotties widget is on the home or lock screen. */
  widgetsInstalled(): Promise<boolean>;
  /** This install's push token, or `null` (no push entitlement yet, simulator, refused, not built). */
  pushToken(): Promise<NativePushToken | null>;
  /** Calls `listener` on every ping; returns the stop. */
  onRemoteChange(listener: () => void): () => void;
  /** The ping was handled (iOS ends the background time it gave: `changed` = new data). */
  remoteChangeDone(changed: boolean): Promise<void>;
}

/** The body of `POST /push/devices`. */
export interface NativePushToken {
  channel: 'apns' | 'fcm';
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

export const nativeSilentPush: SilentPushNative = {
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
