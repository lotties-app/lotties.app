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
    Filesystem: {
      writeFile: vi.fn<(options: unknown) => Promise<{ uri: string }>>(async () => ({
        uri: 'file:///cache/backup.json',
      })),
    },
    Share: { share: vi.fn<(options: unknown) => Promise<unknown>>(async () => ({})) },
  };
});

vi.mock('@capacitor/browser', () => ({ Browser: capacitor.Browser }));
vi.mock('@capacitor/app', () => ({ App: capacitor.App }));
vi.mock('@capacitor/filesystem', () => ({
  Filesystem: capacitor.Filesystem,
  Directory: { Cache: 'CACHE' },
}));
vi.mock('@capacitor/share', () => ({ Share: capacitor.Share }));
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

  it('writes a shared file to the cache directory and opens the share sheet on it', async () => {
    await capacitorShell.shareFile({
      name: 'backup.json',
      mimeType: 'application/json',
      base64: 'e30=',
    });

    expect(capacitor.Filesystem.writeFile).toHaveBeenCalledWith({
      path: 'backup.json',
      data: 'e30=',
      directory: 'CACHE',
    });
    expect(capacitor.Share.share).toHaveBeenCalledWith({
      title: 'backup.json',
      dialogTitle: 'backup.json',
      url: 'file:///cache/backup.json',
    });
  });

  it('treats a cancelled share sheet as done and rethrows other failures', async () => {
    const file = { name: 'a.json', mimeType: 'application/json', base64: 'e30=' };
    capacitor.Share.share.mockRejectedValueOnce(new Error('Share canceled'));
    await expect(capacitorShell.shareFile(file)).resolves.toBeUndefined();

    capacitor.Share.share.mockRejectedValueOnce(new Error('No activity found'));
    await expect(capacitorShell.shareFile(file)).rejects.toThrow('No activity found');
  });
});
