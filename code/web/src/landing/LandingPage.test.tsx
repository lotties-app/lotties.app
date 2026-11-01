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
import summary from '../credits/third-party-summary.generated.json';
import LandingPage from './LandingPage';
import { repoUrl } from './repoUrl';
import { readBuildInfo } from '../config/buildInfo';
import { displayVersion } from '../config/versionInfo';
import { detectInstallPlatform, guideFor } from '../install/installPlatform';
import type { InstallState } from '../install/useInstallState';

const install = vi.fn();
const IOS = detectInstallPlatform(
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
);
const ANDROID = detectInstallPlatform(
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
);
const BASE: Omit<InstallState, 'install'> = {
  native: false,
  installed: false,
  canPrompt: false,
  platform: ANDROID,
  guide: guideFor(ANDROID),
};
let installState: Omit<InstallState, 'install'> = BASE;
vi.mock('../install/useInstallState', () => ({
  useInstallState: () => ({ ...installState, install }),
}));

function renderLanding(
  auth: AuthApi = fakeAuth({ isAuthenticated: false, user: null }),
  welcome = false,
) {
  return render(
    <I18nProvider>
      <AppThemeProvider>
        <AuthTestWrapper auth={auth}>
          <LandingPage welcome={welcome} />
        </AuthTestWrapper>
      </AppThemeProvider>
    </I18nProvider>,
  );
}

beforeEach(() => {
  installState = BASE;
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
      'Install on your phone',
      'Built on open source',
    ]);
    expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(9);
    expect(screen.getByText(/Estimates from your logged history, not medical advice/)).toBeTruthy();
    expect(screen.getByRole('heading', { name: /Not a medical device/ })).toBeTruthy();
    expect(screen.getAllByText(/Not a medical device/).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/AGPL-3\.0/, { selector: 'footer p' })).toBeTruthy();
    // The title is set by an effect that can run just after the page is in the document.
    await waitFor(() => expect(document.title).toBe("Lotties: track your baby's day, together"));
  });

  it('credits open source in a visible section and in the footer, both linking to /credits', async () => {
    renderLanding();
    const section = (
      await screen.findByRole('heading', { level: 2, name: 'Built on open source' })
    ).closest('section')!;
    expect(within(section).getByText(`${summary.count} open-source packages`)).toBeTruthy();
    expect(within(section).getByText(/Including React, MUI, Dexie/)).toBeTruthy();
    expect(within(section).getByText(/AGPL-3\.0/)).toBeTruthy();
    expect(within(section).getByText(/not a medical device/)).toBeTruthy();
    expect(
      within(section)
        .getByRole('link', { name: 'See all credits and licenses' })
        .getAttribute('href'),
    ).toBe('/credits');
    expect(
      within(section)
        .getByRole('link', { name: /Source code on GitHub/ })
        .getAttribute('href'),
    ).toBe('https://github.com/lotties-app/lotties.app');
    const footer = screen.getByRole('contentinfo');
    expect(
      within(footer).getByRole('link', { name: 'Credits and licenses' }).getAttribute('href'),
    ).toBe('/credits');
  });

  it('links the public privacy policy in the footer, next to the credits', async () => {
    renderLanding();
    const footer = await screen.findByRole('contentinfo');
    const links = within(footer)
      .getAllByRole('link')
      .map((link) => [link.textContent, link.getAttribute('href')]);
    const credits = links.findIndex(([, href]) => href === '/credits');
    expect(links[credits + 1]).toEqual(['Privacy policy', '/privacy']);
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

  it('shows the running version in the footer, as text labelled "App version"', async () => {
    renderLanding();
    const footer = await screen.findByRole('contentinfo');
    const line = within(footer).getByTestId('version-line');
    expect(line.textContent).toBe(
      `App version: Lotties ${displayVersion(readBuildInfo().version)}`,
    );
  });

  it('hides the source link without VITE_REPO_URL and shows it for a web address', () => {
    expect(repoUrl({})).toBeNull();
    expect(repoUrl({ VITE_REPO_URL: ' ' })).toBeNull();
    expect(repoUrl({ VITE_REPO_URL: 'javascript:alert(1)' })).toBeNull();
    expect(repoUrl({ VITE_REPO_URL: 'https://example.org/repo' })).toBe('https://example.org/repo');
  });

  describe('install', () => {
    const section = async () =>
      (await screen.findByRole('heading', { level: 2, name: 'Install on your phone' })).closest(
        'section',
      )!;

    it('has a visible install section naming both phones, with the guide link', async () => {
      renderLanding();
      const box = await section();
      expect(within(box).getByText(/iPhone or Android/)).toBeTruthy();
      expect(
        within(box).getByRole('link', { name: 'Step-by-step guide' }).getAttribute('href'),
      ).toBe('/install');
      const footer = screen.getByRole('contentinfo');
      expect(
        within(footer).getByRole('link', { name: 'Install the app' }).getAttribute('href'),
      ).toBe('/install');
    });

    it('opens the browser install prompt when the browser offers one', async () => {
      installState = { ...BASE, canPrompt: true };
      install.mockResolvedValue('accepted');
      renderLanding();
      fireEvent.click(await within(await section()).findByRole('button', { name: 'Install app' }));
      expect(install).toHaveBeenCalledOnce();
    });

    it('opens the Add to Home Screen steps on iPhone, never claiming to install by itself', async () => {
      installState = { ...BASE, platform: IOS, guide: guideFor(IOS) };
      renderLanding();
      fireEvent.click(
        await within(await section()).findByRole('button', { name: 'Add to Home Screen' }),
      );
      const dialog = await screen.findByRole('dialog', { name: 'Add Lotties to your Home Screen' });
      expect(within(dialog).getByText(/does not let a website install itself/)).toBeTruthy();
    });

    it('says so when this is already the installed app', async () => {
      installState = { ...BASE, installed: true };
      renderLanding();
      expect(
        within(await section()).getByText('You are already using the installed app.'),
      ).toBeTruthy();
      expect(screen.queryByRole('button', { name: /Install app|How to install/ })).toBeNull();
    });

    it('has no install section inside the store app', async () => {
      installState = { ...BASE, native: true };
      renderLanding();
      await screen.findByRole('heading', { level: 1 });
      expect(screen.queryByRole('heading', { name: 'Install on your phone' })).toBeNull();
      expect(screen.queryByRole('link', { name: 'Install the app' })).toBeNull();
    });
  });

  describe('welcome (signed in, /welcome)', () => {
    it('offers Back to the app and Open the app instead of sign-in', async () => {
      const auth = fakeAuth({ isAuthenticated: true });
      renderLanding(auth, true);
      expect(
        (await screen.findByRole('link', { name: 'Back to the app' })).getAttribute('href'),
      ).toBe('/');
      expect(screen.getByRole('link', { name: 'Open the app' }).getAttribute('href')).toBe('/');
      expect(screen.queryByRole('button', { name: 'Sign in' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Create an account' })).toBeNull();
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
