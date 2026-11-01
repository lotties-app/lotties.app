/**
 * What the web app uses of the native shell (code/mobile): the system browser for sign-in, the
 * app's URL scheme coming back, and the system bar colours. Only meaningful when `isNativeApp()`;
 * the Capacitor packages load on first use (dynamic imports, their own chunks), so the PWA never
 * downloads them.
 */
export interface NativeShell {
  /** Opens `url` in the system browser (SFSafariViewController, Android Custom Tab). */
  openBrowser(url: string): Promise<void>;
  /** Closes the system browser opened by `openBrowser`, if it is still open. */
  closeBrowser(): Promise<void>;
  /** The user closed the system browser (Android also reports it after a redirect to the app). */
  onBrowserFinished(listener: () => void): Promise<() => void>;
  /** A URL of the app's own scheme opened the running app. */
  onAppUrlOpen(listener: (url: string) => void): Promise<() => void>;
  /** The URL that started the app (a redirect that arrived after the OS stopped it), if any. */
  launchUrl(): Promise<string | undefined>;
  /**
   * Hands a file to the system share sheet ("Save to Files", mail, messaging...): a download link goes
   * nowhere inside the app's WebView. Resolves when the sheet closes, also when the person cancels it.
   */
  shareFile(file: SharedFile): Promise<void>;
  /** Text and icon colour of the status and navigation bars. */
  setSystemBarsStyle(style: SystemBarsStyle): Promise<void>;
  /**
   * Android's hardware/gesture back. While a listener is registered Capacitor does nothing by
   * itself; `canGoBack` says whether the WebView has history to go back to.
   */
  onBackButton(listener: (canGoBack: boolean) => void): Promise<() => void>;
  /** Closes the app (Android; the Activity finishes). */
  exitApp(): Promise<void>;
}

/** A file for `NativeShell.shareFile`: the bytes as base64 (no data-URL prefix). */
export interface SharedFile {
  name: string;
  mimeType: string;
  base64: string;
}

/** A file for `NativeShell.shareFile`: the bytes as base64 (no data-URL prefix). */
export interface SharedFile {
  name: string;
  mimeType: string;
  base64: string;
}

/** `LIGHT`: dark content for a light background; `DARK`: light content for a dark one. */
export type SystemBarsStyle = 'LIGHT' | 'DARK' | 'DEFAULT';

let plugins: Promise<typeof import('./capacitorPlugins')> | undefined;

/** One lazy chunk with every plugin the shell uses, loaded once. */
function load() {
  plugins ??= import('./capacitorPlugins');
  return plugins;
}

const removing = (handle: { remove: () => Promise<void> }) => () => void handle.remove();

/** The Capacitor implementation, used by the app when `isNativeApp()`. */
export const capacitorShell: NativeShell = {
  openBrowser: async (url) => {
    const { Browser } = await load();
    await Browser.open({ url });
  },
  closeBrowser: async () => {
    const { Browser } = await load();
    await Browser.close();
  },
  onBrowserFinished: async (listener) => {
    const { Browser } = await load();
    return removing(await Browser.addListener('browserFinished', listener));
  },
  onAppUrlOpen: async (listener) => {
    const { App } = await load();
    return removing(await App.addListener('appUrlOpen', (event) => listener(event.url)));
  },
  launchUrl: async () => {
    const { App } = await load();
    return (await App.getLaunchUrl())?.url;
  },
  shareFile: async ({ name, base64 }) => {
    const { Directory, Filesystem, Share } = await load();
    // The cache directory is covered by the FileProvider paths of the Android project (file_paths.xml).
    const written = await Filesystem.writeFile({
      path: name,
      data: base64,
      directory: Directory.Cache,
    });
    try {
      await Share.share({ title: name, dialogTitle: name, url: written.uri });
    } catch (error) {
      // Closing the sheet without choosing rejects on some platforms: not a failure.
      if (!/cancel/i.test(error instanceof Error ? error.message : String(error))) throw error;
    }
  },
  setSystemBarsStyle: async (style) => {
    const { SystemBars, SystemBarsStyle } = await load();
    const styles = {
      LIGHT: SystemBarsStyle.Light,
      DARK: SystemBarsStyle.Dark,
      DEFAULT: SystemBarsStyle.Default,
    };
    await SystemBars.setStyle({ style: styles[style] });
  },
  onBackButton: async (listener) => {
    const { App } = await load();
    return removing(await App.addListener('backButton', (event) => listener(event.canGoBack)));
  },
  exitApp: async () => {
    const { App } = await load();
    await App.exitApp();
  },
};
