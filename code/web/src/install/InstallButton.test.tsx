import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pretendNativeApp } from '../platform/nativeTestKit';
import { UA } from './installTestKit';

let standalone = false;

function setMatchMedia() {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query === '(display-mode: standalone)' && standalone,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

function setUserAgent(ua: string, touchPoints = 0) {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(ua);
  Object.defineProperty(navigator, 'maxTouchPoints', { value: touchPoints, configurable: true });
}

/** A Chromium `beforeinstallprompt` event with a mocked prompt and the person's choice. */
function fireBeforeInstallPrompt(outcome: 'accepted' | 'dismissed' = 'accepted') {
  const event = new Event('beforeinstallprompt', { cancelable: true });
  const prompt = vi.fn().mockResolvedValue(undefined);
  Object.assign(event, {
    platforms: ['web'],
    prompt,
    userChoice: Promise.resolve({ outcome, platform: 'web' }),
  });
  act(() => {
    window.dispatchEvent(event);
  });
  return { event, prompt };
}

/** The prompt store lives at module level: each test loads fresh modules after setting the scene. */
async function renderButton() {
  vi.resetModules();
  // Everything that shares module state with the button is loaded fresh with it.
  const { InstallButton } = await import('./InstallButton');
  const { I18nProvider } = await import('../i18n/I18nProvider');
  const { AppThemeProvider } = await import('../theme/AppThemeProvider');
  const { MemoryRouter } = await import('react-router-dom');
  return render(
    <I18nProvider>
      <AppThemeProvider>
        <MemoryRouter>
          <InstallButton />
        </MemoryRouter>
      </AppThemeProvider>
    </I18nProvider>,
  );
}

beforeEach(() => {
  standalone = false;
  setMatchMedia();
  setUserAgent(UA.desktopChrome);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('InstallButton with the browser prompt (Android and desktop Chromium)', () => {
  it('turns into Install app when beforeinstallprompt fires, and keeps the mini-infobar away', async () => {
    await renderButton();
    expect(await screen.findByRole('button', { name: 'How to install' })).toBeTruthy();
    const { event } = fireBeforeInstallPrompt();
    const button = await screen.findByRole('button', { name: 'Install app' });
    expect(button.getAttribute('aria-haspopup')).toBeNull();
    expect(event.defaultPrevented).toBe(true);
  });

  it('opens the prompt once and says it is installing when accepted', async () => {
    await renderButton();
    const { prompt } = fireBeforeInstallPrompt('accepted');
    fireEvent.click(await screen.findByRole('button', { name: 'Install app' }));
    expect(await screen.findByText('Installing Lotties. Open it from its new icon.')).toBeTruthy();
    expect(prompt).toHaveBeenCalledTimes(1);
    // The prompt is spent: the button falls back to the steps.
    expect(screen.getByRole('button', { name: 'How to install' })).toBeTruthy();
  });

  it('says it was not installed when dismissed, and offers the steps instead', async () => {
    await renderButton();
    fireBeforeInstallPrompt('dismissed');
    fireEvent.click(await screen.findByRole('button', { name: 'Install app' }));
    expect(
      await screen.findByText('Not installed. You can install it later from here.'),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'How to install' }));
    expect(await screen.findByRole('dialog', { name: 'Install Lotties' })).toBeTruthy();
  });

  it('disappears after the appinstalled event', async () => {
    await renderButton();
    fireBeforeInstallPrompt();
    await screen.findByRole('button', { name: 'Install app' });
    act(() => {
      window.dispatchEvent(new Event('appinstalled'));
    });
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('InstallButton without a prompt', () => {
  it('on iPhone Safari opens the three steps, focused, and Escape closes them', async () => {
    setUserAgent(UA.iosSafari, 5);
    await renderButton();
    const button = await screen.findByRole('button', { name: 'Add to Home Screen' });
    expect(button.getAttribute('aria-haspopup')).toBe('dialog');
    fireEvent.click(button);
    const dialog = await screen.findByRole('dialog', { name: 'Add Lotties to your Home Screen' });
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    expect(within(dialog).getAllByRole('listitem')).toHaveLength(3);
    expect(within(dialog).getByText(/toolbar at the bottom of the screen/)).toBeTruthy();
    expect(within(dialog).getByText(/does not let a website install itself/)).toBeTruthy();
    expect(within(dialog).queryByText(/open lotties\.app in Safari/)).toBeNull();
    expect(
      within(dialog).getByRole('link', { name: 'See the full instructions' }).getAttribute('href'),
    ).toBe('/install');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('on iPad points at the top right', async () => {
    setUserAgent(UA.ipadDesktopMode, 5);
    await renderButton();
    fireEvent.click(await screen.findByRole('button', { name: 'Add to Home Screen' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/at the top right, next to the address bar/)).toBeTruthy();
  });

  it('on iOS Chrome points at the top right Share and suggests Safari', async () => {
    setUserAgent(UA.iosChrome, 5);
    await renderButton();
    fireEvent.click(await screen.findByRole('button', { name: 'Add to Home Screen' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/top right next to the address bar/)).toBeTruthy();
    expect(within(dialog).getByText(/open lotties\.app in Safari/)).toBeTruthy();
  });

  it('inside an in-app browser asks to open the real browser first', async () => {
    setUserAgent(UA.iosInstagram, 5);
    await renderButton();
    fireEvent.click(await screen.findByRole('button', { name: 'Add to Home Screen' }));
    expect(await screen.findByText(/Choose Open in browser/)).toBeTruthy();
  });

  it('on Firefox for Android shows that browser’s steps; Close returns', async () => {
    setUserAgent(UA.androidFirefox, 5);
    await renderButton();
    fireEvent.click(await screen.findByRole('button', { name: 'How to install' }));
    const dialog = await screen.findByRole('dialog', { name: 'Install Lotties' });
    expect(within(dialog).getByText(/Add to Home screen \(it may say Install\)/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('on desktop Firefox says the browser cannot install', async () => {
    setUserAgent(UA.desktopFirefox);
    await renderButton();
    fireEvent.click(await screen.findByRole('button', { name: 'How to install' }));
    expect(
      await screen.findByText('This browser cannot install apps from a website.'),
    ).toBeTruthy();
  });
});

describe('InstallButton hidden', () => {
  it('when the app already runs standalone', async () => {
    standalone = true;
    const { container } = await renderButton();
    fireBeforeInstallPrompt();
    expect(container.querySelector('button')).toBeNull();
  });

  it('when iOS reports navigator.standalone', async () => {
    setUserAgent(UA.iosSafari, 5);
    Object.defineProperty(navigator, 'standalone', { value: true, configurable: true });
    try {
      const { container } = await renderButton();
      expect(container.querySelector('button')).toBeNull();
    } finally {
      delete (navigator as { standalone?: boolean }).standalone;
    }
  });

  it('inside the store app', async () => {
    const undo = pretendNativeApp();
    try {
      const { container } = await renderButton();
      fireBeforeInstallPrompt();
      expect(container.querySelector('button')).toBeNull();
    } finally {
      undo();
    }
  });
});
