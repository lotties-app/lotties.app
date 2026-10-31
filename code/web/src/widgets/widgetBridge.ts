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
}

interface LottiesSharedPlugin {
  writeSnapshot(options: { json: string }): Promise<void>;
  readOutbox(): Promise<{ json: string }>;
  removeOutbox(options: { ids: string[] }): Promise<void>;
  clearAll(): Promise<void>;
}

let plugin: Promise<LottiesSharedPlugin> | undefined;

function load(): Promise<LottiesSharedPlugin> {
  plugin ??= import('@capacitor/core').then(({ registerPlugin }) =>
    registerPlugin<LottiesSharedPlugin>('LottiesShared'),
  );
  return plugin;
}

/** The Capacitor implementation, used by the app when `isNativeApp()`. */
export const nativeWidgetBridge: WidgetBridge = {
  writeSnapshot: async (json) => (await load()).writeSnapshot({ json }),
  readOutbox: async () => (await (await load()).readOutbox()).json,
  removeOutbox: async (ids) => (await load()).removeOutbox({ ids }),
  clearAll: async () => (await load()).clearAll(),
};
