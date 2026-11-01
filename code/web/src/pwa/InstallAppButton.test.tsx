import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pretendNativeApp } from '../platform/nativeTestKit';

const IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const DESKTOP_CHROME =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

let standalone = false;

function setMatchMedia() {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query === '(display-mode: standalone)' && standalone,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

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

/** The install store is module-level, so each test loads a fresh copy after setting the environment. */
async function loadComponent() {
  vi.resetModules();
  return (await import('./InstallAppButton')).InstallAppButton;
}

function setUserAgent(ua: string) {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(ua);
}

beforeEach(() => {
  standalone = false;
  setMatchMedia();
  setUserAgent(DESKTOP_CHROME);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('InstallAppButton', () => {
  it('renders nothing on a platform without an install prompt', async () => {
    const InstallAppButton = await loadComponent();
    const { container } = render(<InstallAppButton />);
    expect(container.innerHTML).toBe('');
  });

  it('shows the install button after beforeinstallprompt and suppresses the default mini-infobar', async () => {
    const InstallAppButton = await loadComponent();
    render(<InstallAppButton />);
    const { event } = fireBeforeInstallPrompt();
    expect(await screen.findByRole('button', { name: 'Install app' })).toBeTruthy();
    expect(event.defaultPrevented).toBe(true);
  });

  it('opens the deferred prompt on click and hides the button afterwards', async () => {
    const InstallAppButton = await loadComponent();
    render(<InstallAppButton />);
    const { prompt } = fireBeforeInstallPrompt('accepted');
    fireEvent.click(await screen.findByRole('button', { name: 'Install app' }));
    expect(prompt).toHaveBeenCalledTimes(1);
    await act(async () => {});
    expect(screen.queryByRole('button', { name: 'Install app' })).toBeNull();
  });

  it('hides everything after the appinstalled event', async () => {
    const InstallAppButton = await loadComponent();
    const { container } = render(<InstallAppButton />);
    fireBeforeInstallPrompt();
    await screen.findByRole('button', { name: 'Install app' });
    act(() => {
      window.dispatchEvent(new Event('appinstalled'));
    });
    expect(container.innerHTML).toBe('');
  });

  it('shows the iOS Safari hint when not running standalone', async () => {
    setUserAgent(IPHONE_SAFARI);
    const InstallAppButton = await loadComponent();
    render(<InstallAppButton />);
    expect(screen.getByText('To install, tap Share, then Add to Home Screen.')).toBeTruthy();
  });

  it('hides the iOS hint when the app already runs standalone', async () => {
    setUserAgent(IPHONE_SAFARI);
    standalone = true;
    const InstallAppButton = await loadComponent();
    const { container } = render(<InstallAppButton />);
    expect(container.innerHTML).toBe('');
  });

  it('offers neither the install button nor the iOS hint inside the native app', async () => {
    setUserAgent(IPHONE_SAFARI);
    const undo = pretendNativeApp();
    try {
      const InstallAppButton = await loadComponent();
      const { container } = render(<InstallAppButton />);
      fireBeforeInstallPrompt();
      expect(container.innerHTML).toBe('');
    } finally {
      undo();
    }
  });

  it('hides the install button when the app is already installed', async () => {
    standalone = true;
    const InstallAppButton = await loadComponent();
    render(<InstallAppButton />);
    fireBeforeInstallPrompt();
    expect(screen.queryByRole('button', { name: 'Install app' })).toBeNull();
  });
});
