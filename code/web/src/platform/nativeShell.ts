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
  /** Text and icon colour of the status and navigation bars. */
  setSystemBarsStyle(style: SystemBarsStyle): Promise<void>;
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
  setSystemBarsStyle: async (style) => {
    const { SystemBars, SystemBarsStyle } = await load();
    const styles = {
      LIGHT: SystemBarsStyle.Light,
      DARK: SystemBarsStyle.Dark,
      DEFAULT: SystemBarsStyle.Default,
    };
    await SystemBars.setStyle({ style: styles[style] });
  },
};
