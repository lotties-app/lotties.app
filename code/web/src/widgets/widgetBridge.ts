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

/** The Capacitor implementation, used by the app when `isNativeApp()`. */
export const nativeWidgetBridge: WidgetBridge = {
  writeSnapshot: (json) => call('writeSnapshot', (p) => p.writeSnapshot({ json })),
  readOutbox: async () => (await call('readOutbox', (p) => p.readOutbox())).json,
  removeOutbox: (ids) => call('removeOutbox', (p) => p.removeOutbox({ ids })),
  clearAll: () => call('clearAll', (p) => p.clearAll()),
  diagnose: async () => {
    const d = await call('diagnose', (p) => p.diagnose());
    return `container ${d.container ? 'ok' : 'missing'}, snapshot ${size(d.snapshotBytes)}, outbox ${size(d.outboxBytes)}`;
  },
};
