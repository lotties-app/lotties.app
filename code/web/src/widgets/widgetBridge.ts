/**
 * The native side of the home-screen widget and the Siri/Shortcuts intents (docs/design/37-widgets-siri.md):
 * the `LottiesShared` Capacitor plugin (code/mobile/ios/App/LottiesSharedPlugin.swift) reads and writes two JSON
 * files in the App Group container. Only meaningful when `isNativeApp()`; `@capacitor/core` loads on first use
 * (dynamic import), so the PWA never downloads it.
 */
export interface WidgetBridge {
  /** Replaces `widget-snapshot.json` with `json`. */
  writeSnapshot(json: string): Promise<void>;
  /** The text of `widget-outbox.json` (a JSON array; empty array when there is none). */
  readOutbox(): Promise<string>;
  /** Removes the outbox entries with these ids. */
  removeOutbox(ids: string[]): Promise<void>;
  /** Deletes the snapshot and the outbox (sign-out, account erasure). */
  clearAll(): Promise<void>;
  /** One line about what the plugin sees (container, file sizes), for Hub > About. */
  diagnose(): Promise<string>;
  /** Why the plugin may not answer: is it registered in this WebView, and does a stock plugin answer? */
  probe(): Promise<string>;
}

interface LottiesSharedPlugin {
  writeSnapshot(options: { json: string }): Promise<void>;
  readOutbox(): Promise<{ json: string }>;
  removeOutbox(options: { ids: string[] }): Promise<void>;
  clearAll(): Promise<void>;
  diagnose(): Promise<{ container: boolean; snapshotBytes: number; outboxBytes: number }>;
}

let plugin: Promise<LottiesSharedPlugin> | undefined;

function load(): Promise<LottiesSharedPlugin> {
  plugin ??= import('@capacitor/core').then(({ registerPlugin }) =>
    registerPlugin<LottiesSharedPlugin>('LottiesShared'),
  );
  return plugin;
}

/** A native call that never answers (a blocked plugin queue) must become an error, not a promise that hangs. */
async function call<T>(
  method: string,
  run: (plugin: LottiesSharedPlugin) => Promise<T>,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`no answer from the native plugin (${method})`)),
      8000,
    );
  });
  try {
    return await Promise.race([load().then(run), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

const size = (bytes: number) => (bytes < 0 ? 'none' : `${bytes} B`);

/**
 * The app's own WebKit message handler (`LottiesBridgeViewController.swift`): a promise-returning channel that does not
 * depend on Capacitor's plugin dispatch, which never answered `LottiesShared` calls on device.
 */
export interface WebKitHandler {
  postMessage(message: object): Promise<unknown>;
}

export function webkitHandler(): WebKitHandler | undefined {
  const handlers = (
    window as unknown as { webkit?: { messageHandlers?: Record<string, WebKitHandler> } }
  ).webkit?.messageHandlers;
  return handlers?.lotties;
}

export async function viaWebKit(
  handler: WebKitHandler,
  method: string,
  body: object = {},
  timeoutMs = 8000,
): Promise<unknown> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`no answer from the native handler (${method})`)),
      timeoutMs,
    );
  });
  try {
    return await Promise.race([handler.postMessage({ method, ...body }), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** The WebKit handler when the shell has one, else the Capacitor plugin. */
async function native<T>(
  method: string,
  body: object,
  plugin: (p: LottiesSharedPlugin) => Promise<T>,
  fromHandler: (reply: unknown) => T,
): Promise<T> {
  const handler = webkitHandler();
  if (handler) return fromHandler(await viaWebKit(handler, method, body));
  return call(method, plugin);
}

/** The Capacitor implementation, used by the app when `isNativeApp()`. */
export const nativeWidgetBridge: WidgetBridge = {
  writeSnapshot: (json) =>
    native(
      'writeSnapshot',
      { json },
      (p) => p.writeSnapshot({ json }),
      () => undefined,
    ),
  readOutbox: () =>
    native(
      'readOutbox',
      {},
      async (p) => (await p.readOutbox()).json,
      (reply) => String(reply),
    ),
  removeOutbox: (ids) =>
    native(
      'removeOutbox',
      { ids },
      (p) => p.removeOutbox({ ids }),
      () => undefined,
    ),
  clearAll: () =>
    native(
      'clearAll',
      {},
      (p) => p.clearAll(),
      () => undefined,
    ),
  diagnose: () =>
    native(
      'diagnose',
      {},
      async (p) => {
        const d = await p.diagnose();
        return `container ${d.container ? 'ok' : 'missing'}, snapshot ${size(d.snapshotBytes)}, outbox ${size(d.outboxBytes)}`;
      },
      (reply) => String(reply),
    ),
  probe: probeNative,
};

/** Used when `LottiesShared` does not answer: separates "not registered here" from "the native queue is stuck". */
async function probeNative(): Promise<string> {
  const { Capacitor } = await import('@capacitor/core');
  const headers = (Capacitor as unknown as { PluginHeaders?: { name: string }[] }).PluginHeaders;
  const registered = headers?.some((h) => h.name === 'LottiesShared') ?? false;
  let app = 'ok';
  try {
    const { App } = await import('@capacitor/app');
    await Promise.race([
      App.getState(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000)),
    ]);
  } catch (error) {
    app = error instanceof Error ? error.message : 'failed';
  }
  return `platform ${Capacitor.getPlatform()}, webkit handler ${webkitHandler() ? 'yes' : 'no'}, registered ${registered ? 'yes' : 'no'}, available ${
    Capacitor.isPluginAvailable('LottiesShared') ? 'yes' : 'no'
  }, headers ${headers?.length ?? 0}, app plugin ${app}`;
}
