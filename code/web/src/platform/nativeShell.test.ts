import { beforeEach, describe, expect, it, vi } from 'vitest';

// The Capacitor plugins, mocked: the shell must only call them, lazily.
const capacitor = vi.hoisted(() => {
  const remove = vi.fn(async () => {});
  return {
    remove,
    Browser: {
      open: vi.fn(async () => {}),
      close: vi.fn(async () => {}),
      addListener: vi.fn(async () => ({ remove })),
    },
    App: {
      addListener: vi.fn<
        (
          event: string,
          listener: (event: { url: string }) => void,
        ) => Promise<{ remove: typeof remove }>
      >(async () => ({ remove })),
      getLaunchUrl: vi.fn(async (): Promise<{ url: string } | undefined> => undefined),
    },
    SystemBars: { setStyle: vi.fn(async () => {}) },
  };
});

vi.mock('@capacitor/browser', () => ({ Browser: capacitor.Browser }));
vi.mock('@capacitor/app', () => ({ App: capacitor.App }));
vi.mock('@capacitor/core', () => ({
  SystemBars: capacitor.SystemBars,
  SystemBarsStyle: { Dark: 'DARK', Light: 'LIGHT', Default: 'DEFAULT' },
}));

const { capacitorShell } = await import('./nativeShell');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('capacitorShell', () => {
  it('opens and closes the system browser', async () => {
    await capacitorShell.openBrowser('https://auth.test/authorize?x=1');
    await capacitorShell.closeBrowser();

    expect(capacitor.Browser.open).toHaveBeenCalledWith({ url: 'https://auth.test/authorize?x=1' });
    expect(capacitor.Browser.close).toHaveBeenCalled();
  });

  it('passes the URL of appUrlOpen events and removes the listener on stop', async () => {
    const urls: string[] = [];
    const stop = await capacitorShell.onAppUrlOpen((url) => urls.push(url));
    const [event, listener] = capacitor.App.addListener.mock.calls[0];
    listener({ url: 'app.lotties.app://auth/callback?code=1' });
    stop();

    expect(event).toBe('appUrlOpen');
    expect(urls).toEqual(['app.lotties.app://auth/callback?code=1']);
    expect(capacitor.remove).toHaveBeenCalledTimes(1);
  });

  it('listens for the browser closing', async () => {
    const listener = () => {};
    await capacitorShell.onBrowserFinished(listener);

    expect(capacitor.Browser.addListener).toHaveBeenCalledWith('browserFinished', listener);
  });

  it('reads the launch URL', async () => {
    capacitor.App.getLaunchUrl.mockResolvedValueOnce({ url: 'app.lotties.app://auth/logout' });

    expect(await capacitorShell.launchUrl()).toBe('app.lotties.app://auth/logout');
    expect(await capacitorShell.launchUrl()).toBeUndefined();
  });

  it('sets the system bar style through the core SystemBars plugin', async () => {
    await capacitorShell.setSystemBarsStyle('LIGHT');
    await capacitorShell.setSystemBarsStyle('DARK');

    expect(capacitor.SystemBars.setStyle.mock.calls).toEqual([
      [{ style: 'LIGHT' }],
      [{ style: 'DARK' }],
    ]);
  });
});
