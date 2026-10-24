import { render, screen, waitFor, within } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppRoutes } from '../AppRoutes';
import { formatDate } from '../i18n/format';
import { I18nProvider } from '../i18n/I18nProvider';
import { LOCALE_STORAGE_KEY } from '../i18n/localeStorage';
import { NAVIGATION_DENYLIST } from '../pwa/sw/navigation';
import { AppThemeProvider } from '../theme/AppThemeProvider';
import { THEME_STORAGE_KEY } from '../theme/themeStorage';
import { AuthTestWrapper } from '../test/AuthTestWrapper';
import { fakeAuth } from '../test/fakeAuth';
import { POLICY_DOCUMENTS } from './policyDocuments';
import { ISSUES_URL, PRIVATE_REPORT_URL } from './privacyConfig';
import {
  PRIVACY_POLICY_LAST_UPDATED,
  PRIVACY_POLICY_VERSION,
  sectionAnchor,
} from './privacyPolicy';

/* The public /privacy page: no sign-in, both languages, accessible tables, config fallbacks, print. */

function renderPrivacy(route = '/privacy') {
  const auth = fakeAuth({ isAuthenticated: false, user: null });
  const view = render(
    <I18nProvider>
      <AppThemeProvider>
        <AuthTestWrapper auth={auth} route={route}>
          <AppRoutes />
        </AuthTestWrapper>
      </AppThemeProvider>
    </I18nProvider>,
  );
  return { auth, ...view };
}

const sectionTitles = (locale: keyof typeof POLICY_DOCUMENTS) =>
  POLICY_DOCUMENTS[locale].sections.map((section) => section.title);

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the public /privacy route', () => {
  it('opens without signing in and never starts a sign-in', async () => {
    const { auth } = renderPrivacy();
    expect(await screen.findByRole('heading', { level: 1, name: 'Privacy policy' })).toBeTruthy();
    expect(auth.login).not.toHaveBeenCalled();
    expect(screen.getByRole('main')).toBeTruthy();
    // The public top bar: Back and Home.
    const banner = screen.getByRole('banner');
    expect(within(banner).getByRole('button', { name: 'Back' })).toBeTruthy();
    expect(within(banner).getByRole('link', { name: 'Home' }).getAttribute('href')).toBe('/');
    await waitFor(() => expect(document.title).toBe('Privacy policy · Lotties'));
  });

  it('works offline: the app shell serves it and it needs no network', async () => {
    for (const path of ['/privacy', '/hub/privacy', '/doctor/privacy']) {
      expect(
        NAVIGATION_DENYLIST.some((re) => re.test(path)),
        path,
      ).toBe(false);
    }
    const fetch = vi.fn().mockRejectedValue(new TypeError('offline'));
    vi.stubGlobal('fetch', fetch);
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    renderPrivacy();
    expect(await screen.findByRole('heading', { level: 1, name: 'Privacy policy' })).toBeTruthy();
    expect(screen.getAllByRole('heading', { level: 2 }).length).toBeGreaterThan(10);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('shows the summary, the contents and every section, in order, none empty', async () => {
    const { container } = renderPrivacy();
    await screen.findByRole('heading', { level: 1 });
    const h2 = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(h2).toEqual(['In short', 'On this page', ...sectionTitles('en')]);
    const summary = screen.getByRole('region', { name: 'In short' });
    expect(
      within(summary)
        .getAllByRole('heading', { level: 3 })
        .map((h) => h.textContent),
    ).toEqual(['What we collect', 'What we do not do', 'Your key rights']);
    for (const section of POLICY_DOCUMENTS.en.sections) {
      const element = container.querySelector(`[data-section="${section.id}"]`);
      expect(element, section.id).not.toBeNull();
      // More than the heading: every section has text of its own.
      expect((element?.textContent ?? '').length, section.id).toBeGreaterThan(
        section.title.length + 40,
      );
    }
  });

  it('links each section from the contents, with an anchor on its heading', async () => {
    renderPrivacy();
    const contents = await screen.findByRole('navigation', { name: 'On this page' });
    const links = within(contents).getAllByRole('link');
    expect(links.map((link) => link.textContent)).toEqual(sectionTitles('en'));
    for (const section of POLICY_DOCUMENTS.en.sections) {
      const anchor = sectionAnchor(section.id);
      expect(links.some((link) => link.getAttribute('href') === `#${anchor}`)).toBe(true);
      expect(document.getElementById(anchor)?.textContent).toBe(section.title);
    }
  });

  it('has accessible tables with captions, column and row headers', async () => {
    renderPrivacy();
    await screen.findByRole('heading', { level: 1 });
    const data = screen.getByRole('table', { name: 'Information Lotties handles' });
    expect(
      within(data)
        .getAllByRole('columnheader')
        .map((th) => th.textContent),
    ).toEqual(['Information', 'What it includes', 'Why we use it']);
    expect(within(data).getAllByRole('rowheader')).toHaveLength(13);
    expect(within(data).getByRole('rowheader', { name: 'Health information about your baby' }));
    const recipients = screen.getByRole('table', {
      name: 'Who receives data from Lotties, and when',
    });
    expect(within(recipients).getAllByRole('rowheader')).toHaveLength(6);
    expect(within(recipients).getByRole('rowheader', { name: 'Amazon (Alexa)' })).toBeTruthy();
  });

  it('states the version and the date, and the honest key lines', async () => {
    renderPrivacy();
    const date = formatDate(PRIVACY_POLICY_LAST_UPDATED, 'dayMonthYear', 'en');
    expect(
      await screen.findByText(`Version ${PRIVACY_POLICY_VERSION}, last updated on ${date}.`),
    ).toBeTruthy();
    expect(
      screen.getByText(new RegExp(`This is version ${PRIVACY_POLICY_VERSION}, last updated on`)),
    );
    expect(screen.getByText(/It is not a medical device and does not diagnose/)).toBeTruthy();
    expect(screen.getByText(/You are responsible for that information/)).toBeTruthy();
    expect(screen.queryByText(/OWNER TO/i)).toBeNull();
  });

  it('falls back to the project maintainers and the GitHub contact when nothing is configured', async () => {
    vi.stubEnv('VITE_PRIVACY_CONTROLLER_NAME', '');
    vi.stubEnv('VITE_PRIVACY_CONTACT_EMAIL', '');
    vi.stubEnv('VITE_PRIVACY_DPO', '');
    renderPrivacy();
    const controller = await screen.findByRole('region', { name: 'Who is responsible' });
    expect(within(controller).getByText(/the Lotties project maintainers/)).toBeTruthy();
    expect(
      within(controller)
        .getByRole('link', { name: /public issue tracker on GitHub/ })
        .getAttribute('href'),
    ).toBe(ISSUES_URL);
    expect(
      within(controller)
        .getByRole('link', { name: /private report to the maintainers on GitHub/ })
        .getAttribute('href'),
    ).toBe(PRIVATE_REPORT_URL);
    expect(
      within(controller).getByText(/Data protection contact \(encarregado\): the contact above/),
    );
  });

  it('shows the controller, contact and encarregado the owner set at build time', async () => {
    vi.stubEnv('VITE_PRIVACY_CONTROLLER_NAME', 'Ana Souza');
    vi.stubEnv('VITE_PRIVACY_CONTACT_EMAIL', 'privacy@example.org');
    vi.stubEnv('VITE_PRIVACY_DPO', 'dpo@example.org');
    renderPrivacy();
    const controller = await screen.findByRole('region', { name: 'Who is responsible' });
    expect(within(controller).getByText(/Ana Souza/)).toBeTruthy();
    expect(
      within(controller).getByRole('link', { name: 'privacy@example.org' }).getAttribute('href'),
    ).toBe('mailto:privacy@example.org');
    expect(
      within(controller).getByRole('link', { name: 'dpo@example.org' }).getAttribute('href'),
    ).toBe('mailto:dpo@example.org');
    expect(within(controller).queryByText(/project maintainers/)).toBeNull();
  });

  it('has a print stylesheet that keeps only the policy', async () => {
    renderPrivacy();
    await screen.findByRole('heading', { level: 1 });
    const css = [...document.querySelectorAll('style')].map((s) => s.textContent ?? '').join('\n');
    expect(css).toMatch(/@media print/);
    expect(css).toContain('data-privacy-toc');
    expect(css).toContain('attr(href)');
  });

  it('shows the policy in Portuguese', async () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'pt-BR');
    renderPrivacy();
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Política de privacidade' }),
    ).toBeTruthy();
    await waitFor(() =>
      expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
        'Em resumo',
        'Nesta página',
        ...sectionTitles('pt-BR'),
      ]),
    );
    expect(screen.getByRole('table', { name: 'Informações que o Lotties trata' })).toBeTruthy();
    expect(screen.getByText(/os mantenedores do projeto Lotties/)).toBeTruthy();
    const date = formatDate(PRIVACY_POLICY_LAST_UPDATED, 'dayMonthYear', 'pt-BR');
    expect(
      screen.getByText(`Versão ${PRIVACY_POLICY_VERSION}, atualizada em ${date}.`),
    ).toBeTruthy();
    expect(document.querySelector('[data-privacy-policy]')?.getAttribute('lang')).toBe('pt-BR');
  });
});

describe.each([
  ['light', 'en'],
  ['dark', 'en'],
  ['light', 'pt-BR'],
  ['dark', 'pt-BR'],
] as const)('the privacy page in the %s scheme, %s', (scheme, locale) => {
  it('has no accessibility violations', async () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, scheme);
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    const { container } = renderPrivacy();
    await screen.findByRole('heading', { level: 1 });
    await waitFor(() => expect(screen.getAllByRole('table')).toHaveLength(2));
    expect(document.documentElement.hasAttribute(`data-${scheme}`)).toBe(true);
    const result = await axe.run(container, {
      runOnly: ['wcag2a', 'wcag2aa'],
      rules: { 'color-contrast': { enabled: false } },
    });
    expect(result.violations.map((v) => `${v.id}: ${v.nodes[0]?.html}`)).toEqual([]);
  });
});
