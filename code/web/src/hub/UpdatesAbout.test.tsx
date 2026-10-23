import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { I18nProvider } from '../i18n/I18nProvider';
import { useTestLocale } from '../test/locale';
import { pretendNativeApp } from '../platform/nativeTestKit';
import { readBuildInfo } from '../config/buildInfo';
import {
  checkForUpdates,
  resetUpdateStore,
  setRegistration,
  setReload,
  setWaiting,
} from '../pwa/updateStore';
import { AboutScreen } from './AboutScreen';
import { UpdatesScreen } from './UpdatesScreen';

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
});

afterEach(() => {
  undoNative?.();
  undoNative = undefined;
  // @ts-expect-error removing the property the test added
  delete navigator.serviceWorker;
});

describe('Check for updates', () => {
  it('starts with the version and a button, and no status yet', () => {
    renderScreen(<UpdatesScreen />);
    expect(screen.getByText(`You have version ${readBuildInfo().version}.`)).toBeTruthy();
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
  it('shows the version, build date, licence and a source link when the repo is configured', () => {
    vi.stubEnv('VITE_REPO_URL', 'https://example.org/lotties');
    renderScreen(<AboutScreen />);
    const info = readBuildInfo();
    expect(screen.getByText('Version')).toBeTruthy();
    expect(screen.getByText(info.version)).toBeTruthy();
    expect(screen.getByText('Built')).toBeTruthy();
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

  it('stamps the build: a version and an ISO build time from the bundler', () => {
    const info = readBuildInfo();
    expect(info.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(Number.isNaN(Date.parse(info.builtAt))).toBe(false);
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
