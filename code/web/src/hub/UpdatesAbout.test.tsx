import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { I18nProvider } from '../i18n/I18nProvider';
import { useTestLocale } from '../test/locale';
import { pretendNativeApp } from '../platform/nativeTestKit';
import { fetchServerVersion } from '../config/serverVersion';
import {
  checkForUpdates,
  resetUpdateStore,
  setRegistration,
  setReload,
  setWaiting,
} from '../pwa/updateStore';
import { AboutScreen } from './AboutScreen';
import { UpdatesScreen } from './UpdatesScreen';

// This bundle as a stamped release (a test build is otherwise "dev").
vi.mock('../config/buildInfo', () => ({
  readBuildInfo: () => ({
    version: '0.1.38',
    commit: 'abc1234def',
    builtAt: '2026-10-24T10:00:00.000Z',
  }),
}));

const fetchMock = vi.fn();

/** The server's GET /api/v1/version answers with this body. */
function serverAnswers(body: { version: string; commit: string; builtAt: string | null }) {
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify({ name: 'lotties-api', ...body }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

/** A fake service worker registration whose `update()` the test controls. */
function registration(update: () => Promise<void>, parts: Partial<ServiceWorkerRegistration> = {}) {
  return {
    update,
    installing: null,
    waiting: null,
    ...parts,
  } as unknown as ServiceWorkerRegistration;
}

const renderScreen = (ui: React.ReactNode) =>
  render(
    <I18nProvider>
      <MemoryRouter>{ui}</MemoryRouter>
    </I18nProvider>,
  );

let undoNative: (() => void) | undefined;

beforeEach(() => {
  // jsdom has no service worker API: pretend this browser has one.
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { getRegistration: vi.fn(async () => undefined), ready: new Promise(() => undefined) },
  });
  resetUpdateStore();
  fetchMock.mockReset();
  serverAnswers({ version: '0.1.38', commit: 'abc1234def', builtAt: '2026-10-24T10:00:00Z' });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  undoNative?.();
  undoNative = undefined;
  vi.unstubAllGlobals();
  // @ts-expect-error removing the property the test added
  delete navigator.serviceWorker;
});

describe('Check for updates', () => {
  it('starts with the version and a button, and no status yet', () => {
    renderScreen(<UpdatesScreen />);
    expect(screen.getByText('You have version v0.1.38.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Check for updates' })).toBeTruthy();
    expect(screen.getByTestId('update-status').textContent).toBe('');
  });

  it('shows checking, then up to date with the time', async () => {
    let finish: () => void = () => undefined;
    setRegistration(registration(() => new Promise<void>((resolve) => (finish = resolve))));
    renderScreen(<UpdatesScreen />);

    fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }));
    expect(await screen.findByText('Checking for updates…')).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: 'Check for updates' }) as HTMLButtonElement).disabled,
    ).toBe(true);

    await act(async () => finish());
    expect(await screen.findByText(/You have the latest version\. Checked at /)).toBeTruthy();
    expect(screen.getByTestId('update-status').getAttribute('aria-live')).toBe('polite');
  });

  it('offers the reload when a new version finishes installing, and reloads through the worker', async () => {
    const reload = vi.fn(async () => undefined);
    setReload(reload);
    const worker = Object.assign(new EventTarget(), { state: 'installing' });
    const reg = registration(async () => undefined, {
      installing: worker as unknown as ServiceWorker,
    });
    setRegistration(reg);
    renderScreen(<UpdatesScreen />);

    fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }));
    expect(await screen.findByText('Checking for updates…')).toBeTruthy();
    // The new worker finishes installing and waits.
    Object.defineProperty(reg, 'waiting', { value: {} });
    worker.state = 'installed';
    await act(async () => void worker.dispatchEvent(new Event('statechange')));

    expect(await screen.findByText('A new version is ready.')).toBeTruthy();
    expect(screen.getByText(/Changes not yet synced stay on this device/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Reload to update' }));
    expect(reload).toHaveBeenCalledWith(true);
  });

  it('is ready at once when the app already knows a version is waiting', async () => {
    setRegistration(registration(async () => undefined));
    act(() => setWaiting(true));
    renderScreen(<UpdatesScreen />);
    expect(screen.getByText('A new version is ready.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Check for updates' })).toBeNull();
  });

  it('says the check failed and offers to try again', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    setRegistration(
      registration(async () => {
        throw new Error('offline');
      }),
    );
    renderScreen(<UpdatesScreen />);
    fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }));
    expect(await screen.findByText(/Could not check\. Make sure you are online/)).toBeTruthy();

    setRegistration(registration(async () => undefined));
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText(/You have the latest version/)).toBeTruthy();
  });

  it('explains that the native app is updated through the store', () => {
    undoNative = pretendNativeApp();
    renderScreen(<UpdatesScreen />);
    expect(screen.getByText('This app is updated through the app store.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Check for updates' })).toBeNull();
  });

  it('does not start a second check while one runs', async () => {
    const update = vi.fn(() => new Promise<void>(() => undefined));
    setRegistration(registration(update));
    void checkForUpdates();
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    await checkForUpdates();
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('is in Portuguese', async () => {
    await useTestLocale('pt-BR');
    setRegistration(registration(async () => undefined));
    renderScreen(<UpdatesScreen />);
    fireEvent.click(screen.getByRole('button', { name: 'Buscar atualizações' }));
    expect(
      await screen.findByText(/Você está na versão mais recente\. Verificado às /),
    ).toBeTruthy();
  });
});

describe('About', () => {
  it('shows this device and the server, each with version, commit and build time', async () => {
    serverAnswers({ version: '0.1.38', commit: 'fedcba9876', builtAt: '2026-10-24T09:00:00Z' });
    renderScreen(<AboutScreen />);
    expect(screen.getByText('App (this device)')).toBeTruthy();
    expect(screen.getByText(/^v0\.1\.38 · commit abc1234 · built /)).toBeTruthy();
    expect(screen.getByText('Checking the server…')).toBeTruthy();
    expect(await screen.findByText(/^v0\.1\.38 · commit fedcba9 · built /)).toBeTruthy();
    expect(screen.getByText('Server')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/version',
      expect.objectContaining({ credentials: 'omit' }),
    );
    expect(screen.queryByText(/An update is available/)).toBeNull();
  });

  it('shows a newer server without any update hint when no app update is waiting', async () => {
    setRegistration(registration(async () => undefined));
    serverAnswers({ version: '0.1.39', commit: 'fedcba9', builtAt: null });
    renderScreen(<AboutScreen />);
    expect(await screen.findByText(/^v0\.1\.39 · commit fedcba9$/)).toBeTruthy();
    expect(screen.getByText('The server was updated separately.')).toBeTruthy();
    expect(screen.queryByText('An update is available.')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reload to update' })).toBeNull();
  });

  it('says nothing about the server when both run the same release', async () => {
    serverAnswers({ version: '0.1.38', commit: 'fedcba9', builtAt: null });
    renderScreen(<AboutScreen />);
    await screen.findByText(/commit fedcba9/);
    expect(screen.queryByText('The server was updated separately.')).toBeNull();
    expect(screen.queryByText('An update is available.')).toBeNull();
  });

  it('offers the reload when a new app version is waiting, whatever the server says', async () => {
    const reload = vi.fn(async () => undefined);
    setReload(reload);
    act(() => setWaiting(true));
    serverAnswers({ version: '0.1.38', commit: 'abc1234def', builtAt: null });
    renderScreen(<AboutScreen />);
    expect(screen.getByText('An update is available.')).toBeTruthy();
    expect(screen.queryByText('The server was updated separately.')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Reload to update' }));
    expect(reload).toHaveBeenCalledWith(true);
  });

  it('keeps the reload and drops the neutral note when an update waits and the versions differ', async () => {
    act(() => setWaiting(true));
    serverAnswers({ version: '0.2.0', commit: '', builtAt: null });
    renderScreen(<AboutScreen />);
    expect(await screen.findByText('v0.2.0')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reload to update' })).toBeTruthy();
    expect(screen.queryByText('The server was updated separately.')).toBeNull();
  });

  it('says the server version is unavailable when the request fails, and keeps the screen', async () => {
    fetchMock.mockRejectedValue(new TypeError('offline'));
    renderScreen(<AboutScreen />);
    expect(await screen.findByText('Server version unavailable')).toBeTruthy();
    expect(screen.getByText(/^v0\.1\.38 · commit abc1234/)).toBeTruthy();
  });

  it('gives up on a server that does not answer in time', async () => {
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) =>
          init.signal?.addEventListener('abort', () => reject(new DOMException('', 'AbortError'))),
        ),
    );
    expect(await fetchServerVersion('', 10)).toBeNull();
  });

  it('treats an unexpected answer as unavailable', async () => {
    fetchMock.mockResolvedValue(new Response('<html>', { status: 200 }));
    expect(await fetchServerVersion('', 1000)).toBeNull();
    fetchMock.mockResolvedValue(new Response('{}', { status: 500 }));
    expect(await fetchServerVersion('', 1000)).toBeNull();
  });

  it('copies the version info for a bug report', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    serverAnswers({ version: '0.1.38', commit: 'fedcba9876', builtAt: null });
    renderScreen(<AboutScreen />);
    await screen.findByText(/commit fedcba9/);
    fireEvent.click(screen.getByRole('button', { name: 'Copy version info' }));
    expect(await screen.findByText('Version info copied.')).toBeTruthy();
    expect(writeText).toHaveBeenCalledWith(
      'Lotties app v0.1.38 (commit abc1234), server v0.1.38 (commit fedcba9)',
    );
    // @ts-expect-error removing the property the test added
    delete navigator.clipboard;
  });

  it('says so when the copy fails', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn(async () => Promise.reject(new Error('denied'))) },
    });
    fetchMock.mockRejectedValue(new TypeError('offline'));
    renderScreen(<AboutScreen />);
    await screen.findByText('Server version unavailable');
    fireEvent.click(screen.getByRole('button', { name: 'Copy version info' }));
    expect(await screen.findByText(/Could not copy/)).toBeTruthy();
    // @ts-expect-error removing the property the test added
    delete navigator.clipboard;
  });

  it('has the licence and a source link when the repo is configured', () => {
    vi.stubEnv('VITE_REPO_URL', 'https://example.org/lotties');
    renderScreen(<AboutScreen />);
    expect(screen.getByText('Free software, AGPL-3.0')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Source code' }).getAttribute('href')).toBe(
      'https://example.org/lotties',
    );
    vi.unstubAllEnvs();
  });

  it('has no source link without a repository address', () => {
    vi.stubEnv('VITE_REPO_URL', '');
    renderScreen(<AboutScreen />);
    expect(screen.queryByRole('link', { name: 'Source code' })).toBeNull();
    vi.unstubAllEnvs();
  });

  it('links credits and privacy inside the doctor shell', () => {
    renderScreen(<AboutScreen basePath="/doctor" />);
    expect(screen.getByRole('link', { name: /Credits and licenses/ }).getAttribute('href')).toBe(
      '/doctor/credits',
    );
  });

  it('is in Portuguese', async () => {
    await useTestLocale('pt-BR');
    fetchMock.mockRejectedValue(new TypeError('offline'));
    renderScreen(<AboutScreen />);
    expect(screen.getByText('App (este aparelho)')).toBeTruthy();
    expect(await screen.findByText('Versão do servidor indisponível')).toBeTruthy();
  });
});

describe.each(['updates', 'about'] as const)('accessibility of %s', (name) => {
  it('has no violations', async () => {
    renderScreen(name === 'updates' ? <UpdatesScreen /> : <AboutScreen />);
    const result = await axe.run(document.body, {
      runOnly: ['wcag2a', 'wcag2aa'],
      rules: { 'color-contrast': { enabled: false } },
    });
    expect(result.violations.map((v) => v.id)).toEqual([]);
  });
});
