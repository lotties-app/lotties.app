import { readFileSync } from 'node:fs';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import axe from 'axe-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../i18n/I18nProvider';
import { LOCALE_STORAGE_KEY } from '../i18n/localeStorage';
import { AppThemeProvider } from '../theme/AppThemeProvider';
import { nightPeriodKey } from '../theme/nightFeed';
import { NIGHT_FEED_STATE_STORAGE_KEY } from '../theme/nightFeedStorage';
import { THEME_STORAGE_KEY } from '../theme/themeStorage';
import type { AuthApi } from '../auth/AuthContext';
import { AuthTestWrapper } from '../test/AuthTestWrapper';
import { fakeAuth } from '../test/fakeAuth';
import LandingPage from './LandingPage';
import { repoUrl } from './repoUrl';

const install = vi.fn();
let installState = { canInstall: false, showIosHint: false };
vi.mock('../pwa/useInstallPrompt', () => ({
  useInstallPrompt: () => ({ ...installState, install }),
}));

function renderLanding(auth: AuthApi = fakeAuth({ isAuthenticated: false, user: null })) {
  return render(
    <I18nProvider>
      <AppThemeProvider>
        <AuthTestWrapper auth={auth}>
          <LandingPage />
        </AuthTestWrapper>
      </AppThemeProvider>
    </I18nProvider>,
  );
}

beforeEach(() => {
  installState = { canInstall: false, showIosHint: false };
  install.mockReset();
  document.title = 'Lotties';
});

describe('LandingPage', () => {
  it('has one h1, a skip link, sections as h2 and the honest claims', async () => {
    renderLanding();
    expect(await screen.findAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Skip to content' }).getAttribute('href')).toBe(
      '#landing-main',
    );
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
      'What it does',
      'Not a medical device',
      'How it works',
    ]);
    expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(9);
    expect(screen.getByText(/Estimates from your logged history, not medical advice/)).toBeTruthy();
    expect(screen.getByRole('heading', { name: /Not a medical device/ })).toBeTruthy();
    expect(screen.getAllByText(/Not a medical device/).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/AGPL-3\.0/, { selector: 'footer p' })).toBeTruthy();
    // The title is set by an effect that can run just after the page is in the document.
    await waitFor(() => expect(document.title).toBe("Lotties: track your baby's day, together"));
  });

  it('starts sign-in from the header and the hero, and registration from the secondary button', async () => {
    const auth = fakeAuth({ isAuthenticated: false, user: null });
    renderLanding(auth);
    const [header, hero] = await screen.findAllByRole('button', { name: 'Sign in' });
    fireEvent.click(header);
    fireEvent.click(hero);
    expect(auth.login).toHaveBeenNthCalledWith(1, '/', undefined);
    expect(auth.login).toHaveBeenNthCalledWith(2, '/', undefined);
    fireEvent.click(screen.getByRole('button', { name: 'Create an account' }));
    expect(auth.login).toHaveBeenLastCalledWith('/', { register: true });
  });

  it('shows the error card with a retry when the sign-in failed or could not start', async () => {
    const login = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
    renderLanding(fakeAuth({ isAuthenticated: false, user: null, login }));
    fireEvent.click((await screen.findAllByRole('button', { name: 'Sign in' }))[1]);
    expect(await screen.findByRole('alert')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(login).toHaveBeenCalledTimes(2);
  });

  it('shows the session-ended card', async () => {
    renderLanding(fakeAuth({ isAuthenticated: false, user: null, sessionEnded: true }));
    expect(await screen.findByText('Your session ended')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('Sign in to carry on');
  });

  it('lets the visitor switch language and theme in the footer', async () => {
    renderLanding();
    await screen.findByRole('heading', { level: 1 });
    const language = screen.getByRole('radiogroup', { name: 'Language' });
    fireEvent.click(within(language).getByRole('radio', { name: 'Português' }));
    expect(await screen.findByRole('heading', { level: 1, name: /Acompanhe o dia/ })).toBeTruthy();
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('pt-BR');
    expect(document.documentElement.lang).toBe('pt-BR');

    fireEvent.click(
      within(screen.getByRole('radiogroup', { name: 'Tema' })).getByRole('radio', {
        name: 'Escuro',
      }),
    );
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
  });

  it('hides the source link without VITE_REPO_URL and shows it for a web address', () => {
    expect(repoUrl({})).toBeNull();
    expect(repoUrl({ VITE_REPO_URL: ' ' })).toBeNull();
    expect(repoUrl({ VITE_REPO_URL: 'javascript:alert(1)' })).toBeNull();
    expect(repoUrl({ VITE_REPO_URL: 'https://example.org/repo' })).toBe('https://example.org/repo');
  });

  describe('install', () => {
    it('offers the install button when the browser can install the app', async () => {
      installState = { canInstall: true, showIosHint: false };
      renderLanding();
      fireEvent.click(await screen.findByRole('button', { name: 'Install app' }));
      expect(install).toHaveBeenCalledOnce();
    });

    it('shows the iOS hint where install is manual', async () => {
      installState = { canInstall: false, showIosHint: true };
      renderLanding();
      expect(await screen.findByText(/Add to Home Screen/)).toBeTruthy();
    });

    it('shows neither when the app is installed or cannot be', async () => {
      renderLanding();
      await screen.findByRole('heading', { level: 1 });
      expect(screen.queryByRole('button', { name: 'Install app' })).toBeNull();
      expect(screen.queryByText(/Add to Home Screen/)).toBeNull();
    });
  });
});

describe.each(['light', 'dark', 'night'] as const)('LandingPage in the %s scheme', (scheme) => {
  it('has no accessibility violations, also with a notice shown', async () => {
    if (scheme === 'night') {
      window.localStorage.setItem(
        NIGHT_FEED_STATE_STORAGE_KEY,
        JSON.stringify({ override: { on: true, key: nightPeriodKey(new Date()) } }),
      );
    } else {
      window.localStorage.setItem(THEME_STORAGE_KEY, scheme);
    }
    const { container } = renderLanding(
      fakeAuth({ isAuthenticated: false, user: null, error: new Error('denied') }),
    );
    await screen.findByRole('heading', { level: 1 });
    expect(document.documentElement.hasAttribute(`data-${scheme}`)).toBe(true);
    const result = await axe.run(container, {
      runOnly: ['wcag2a', 'wcag2aa'],
      rules: { 'color-contrast': { enabled: false } }, // checked on the real page in the screenshots
    });
    expect(result.violations.map((v) => `${v.id}: ${v.nodes[0]?.html}`)).toEqual([]);
  });
});

describe('claims', () => {
  it('claims "no tracking" only while the web app has no analytics or telemetry dependency', async () => {
    const manifest = JSON.parse(readFileSync('package.json', 'utf-8')) as {
      dependencies: Record<string, string>;
    };
    const tracker =
      /analytics|telemetry|sentry|posthog|mixpanel|segment|amplitude|hotjar|matomo|plausible|gtag/i;
    const found = Object.keys(manifest.dependencies).filter((name) => tracker.test(name));
    renderLanding();
    await screen.findByRole('heading', { level: 1 });
    const claimed = /no tracking/i.test(document.body.textContent ?? '');
    expect(claimed && found.length > 0, `tracking dependencies: ${found.join(', ')}`).toBe(false);
  });
});
