import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppRoutes } from '../AppRoutes';
import { I18nProvider } from '../i18n/I18nProvider';
import { LOCALE_STORAGE_KEY } from '../i18n/localeStorage';
import { AppThemeProvider } from '../theme/AppThemeProvider';
import { THEME_STORAGE_KEY } from '../theme/themeStorage';
import { AuthTestWrapper } from '../test/AuthTestWrapper';
import { fakeAuth } from '../test/fakeAuth';
import { readBuildInfo } from '../config/buildInfo';
import { displayVersion } from '../config/versionInfo';
import { CURATED_CREDITS } from './curatedCredits';
import { PackageRow } from './PackageList';
import summary from './third-party-summary.generated.json';

function renderCredits() {
  const auth = fakeAuth({ isAuthenticated: false, user: null });
  const view = render(
    <I18nProvider>
      <AppThemeProvider>
        <AuthTestWrapper auth={auth} route="/credits">
          <AppRoutes />
        </AuthTestWrapper>
      </AppThemeProvider>
    </I18nProvider>,
  );
  return { auth, ...view };
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the public /credits route', () => {
  it('opens without signing in and never starts a sign-in', async () => {
    const { auth } = renderCredits();
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Credits and licenses' }),
    ).toBeTruthy();
    expect(auth.login).not.toHaveBeenCalled();
    expect(screen.getByRole('main')).toBeTruthy();
    expect(screen.getByRole('banner')).toBeTruthy();
    await waitFor(() => expect(document.title).toBe('Credits and licenses · Lotties'));
  });

  it('ends with the running version', async () => {
    renderCredits();
    await screen.findByRole('heading', { level: 1, name: 'Credits and licenses' });
    expect(screen.getByTestId('version-line').textContent).toBe(
      `App version: Lotties ${displayVersion(readBuildInfo().version)}`,
    );
  });

  it('has the sections, the license, the source and the honest wording', async () => {
    renderCredits();
    await screen.findByRole('heading', { level: 1 });
    const sections = await screen.findAllByRole('heading', { level: 2 });
    expect(sections.map((h) => h.textContent)).toEqual([
      'Our license and source',
      'Data and services',
      'Open-source software we build on',
      'All packages and license texts',
    ]);
    expect(screen.getByText(/GNU Affero General Public License v3\.0/)).toBeTruthy();
    const source = screen.getByRole('link', { name: /Source code on GitHub/ });
    expect(source.getAttribute('href')).toBe('https://github.com/dev-vinicius-andrade/lotties.app');
    expect(source.getAttribute('rel')).toContain('noopener');
    expect(screen.getByText(/does not mean that it endorses/)).toBeTruthy();
    expect(screen.getByText(/not a medical device/i)).toBeTruthy();
    // Every curated credit is there with its link; the vaccine data carries the CC BY-ND notice.
    const links = screen.getAllByRole('link');
    for (const item of CURATED_CREDITS) {
      const link = links.find((a) => a.textContent?.includes(item.name));
      expect(link?.getAttribute('href'), item.name).toBe(item.url);
    }
    expect(screen.getByText(/CC BY-ND 3\.0/, { selector: 'p' })).toBeTruthy();
    expect(screen.getByText(/Data © OpenStreetMap contributors/)).toBeTruthy();
  });

  it('lists the direct dependencies from the generated data, grouped by app and server', async () => {
    renderCredits();
    const direct = await screen.findByRole('region', { name: 'Open-source software we build on' });
    expect(await within(direct).findByText('react', { selector: 'a' })).toBeTruthy();
    expect(
      within(direct).getByRole('heading', { level: 3, name: 'Web and mobile app' }),
    ).toBeTruthy();
    expect(within(direct).getByRole('heading', { level: 3, name: 'Server' })).toBeTruthy();
    expect(
      within(direct).getByText('Microsoft.EntityFrameworkCore', { selector: 'a' }),
    ).toBeTruthy();
    expect(within(direct).getByText(/more packages come with them/)).toBeTruthy();
  });

  it('searches every package and opens a license text on demand', async () => {
    renderCredits();
    const all = await screen.findByRole('region', { name: 'All packages and license texts' });
    const toggle = await within(all).findByRole('button', { name: /^Show all \d+ packages$/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(within(all).getByRole('status').textContent).toBe(`${summary.count} packages`);

    const search = within(all).getByRole('searchbox', { name: 'Search packages and licenses' });
    fireEvent.change(search, { target: { value: 'dexie' } });
    expect(within(all).getAllByRole('listitem').length).toBe(2);
    fireEvent.change(search, { target: { value: 'zzz-no-such-package' } });
    expect(within(all).getByRole('status').textContent).toBe(
      'No package matches “zzz-no-such-package”.',
    );
    fireEvent.change(search, { target: { value: 'dexie' } });

    const open = within(all).getAllByRole('button', { name: 'License text of dexie' })[0];
    expect(open.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(open);
    const text = await within(all).findByRole('region', { name: 'License text of dexie' });
    expect(text.textContent).toMatch(/Apache License/i);
    expect(text.getAttribute('tabindex')).toBe('0');
    expect(text.getAttribute('lang')).toBe('en');
  });

  it('says so when a package ships no license file', async () => {
    render(
      <I18nProvider>
        <AppThemeProvider>
          <ul>
            <PackageRow
              pkg={{
                ecosystem: 'npm',
                name: 'no-license-file',
                version: '1.0.0',
                license: 'MIT',
                homepage: null,
                repository: null,
                direct: false,
                sources: ['web'],
                licenseId: null,
              }}
            />
          </ul>
        </AppThemeProvider>
      </I18nProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'License text of no-license-file' }));
    expect(await screen.findByText(/does not ship a license file/)).toBeTruthy();
    expect(
      screen.getByRole('link', { name: /License text on spdx\.org/ }).getAttribute('href'),
    ).toBe('https://spdx.org/licenses/MIT.html');
  });

  it('shows the page in Portuguese', async () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'pt-BR');
    renderCredits();
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Créditos e licenças' }),
    ).toBeTruthy();
    await waitFor(() =>
      expect(
        screen.getByRole('heading', { level: 2, name: 'Nossa licença e o código-fonte' }),
      ).toBeTruthy(),
    );
    expect(
      screen.getByText(/Conteúdo publicado pelo Ministério da Saúde sob CC BY-ND 3\.0/),
    ).toBeTruthy();
  });

  it('opens external links in the system browser inside the native app', async () => {
    const openBrowser = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('Capacitor', { isNativePlatform: () => true });
    vi.doMock('../platform/nativeShell', () => ({ capacitorShell: { openBrowser } }));
    try {
      renderCredits();
      const link = await screen.findByRole('link', { name: /Source code on GitHub/ });
      fireEvent.click(link);
      await waitFor(() =>
        expect(openBrowser).toHaveBeenCalledWith(
          'https://github.com/dev-vinicius-andrade/lotties.app',
        ),
      );
    } finally {
      vi.unstubAllGlobals();
      vi.doUnmock('../platform/nativeShell');
    }
  });
});

describe.each([
  ['light', 'en'],
  ['dark', 'en'],
  ['light', 'pt-BR'],
  ['dark', 'pt-BR'],
] as const)('the credits page in the %s scheme, %s', (scheme, locale) => {
  it('has no accessibility violations, with the package list and a license text open', async () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, scheme);
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    const { container } = renderCredits();
    await screen.findByRole('heading', { level: 1 });
    const toggle = await screen.findByRole('button', { name: /^(Show all|Mostrar todos)/ });
    fireEvent.click(toggle);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'dexie' } });
    fireEvent.click(screen.getAllByRole('button', { name: /dexie$/ })[0]);
    await waitFor(() => expect(container.querySelector('pre')).not.toBeNull());
    expect(document.documentElement.hasAttribute(`data-${scheme}`)).toBe(true);
    const result = await axe.run(container, {
      runOnly: ['wcag2a', 'wcag2aa'],
      rules: { 'color-contrast': { enabled: false } },
    });
    expect(result.violations.map((v) => `${v.id}: ${v.nodes[0]?.html}`)).toEqual([]);
  });
});
