import { render, screen, within } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppRoutes } from '../AppRoutes';
import { formatDate } from '../i18n/format';
import { I18nProvider } from '../i18n/I18nProvider';
import { LOCALE_STORAGE_KEY } from '../i18n/localeStorage';
import { AppThemeProvider } from '../theme/AppThemeProvider';
import { THEME_STORAGE_KEY } from '../theme/themeStorage';
import { AuthTestWrapper } from '../test/AuthTestWrapper';
import { fakeAuth } from '../test/fakeAuth';
import { TERMS_LAST_UPDATED, TERMS_VERSION } from './consentVersions';
import { parseInline, type UrlToken } from './inlineText';
import { SOURCE_REPOSITORY } from '../credits/curatedCredits';
import { TERMS_DOCUMENTS } from './termsDocuments';
import { TERMS_CLAUSE_IDS } from './termsTypes';

/* The public /terms page (docs/design/38-consent-and-terms.md section 5): no sign-in, both languages, the draft's fourteen clauses. */

function renderTerms(route = '/terms') {
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

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('terms content', () => {
  const documents = Object.values(TERMS_DOCUMENTS);

  it.each(documents.map((document) => [document.locale, document] as const))(
    'has the same fourteen clauses, in the same order, as the draft (%s)',
    (_, document) => {
      expect(document.clauses.map((clause) => clause.id)).toEqual([...TERMS_CLAUSE_IDS]);
      for (const clause of document.clauses) {
        expect(clause.title.trim()).not.toBe('');
        expect(clause.text.trim()).not.toBe('');
      }
    },
  );

  it.each(documents.map((document) => [document.locale, document] as const))(
    'links only to the policy and the source, and fills only known values (%s)',
    (_, document) => {
      const urls = {
        issuesUrl: 'x',
        advisoryUrl: 'y',
        repoUrl: SOURCE_REPOSITORY,
      } satisfies Record<UrlToken, string>;
      for (const clause of document.clauses) {
        for (const part of parseInline(clause.text, urls)) {
          if (part.kind === 'link' && part.target === 'route') expect(part.href).toBe('/privacy');
          if (part.kind === 'link' && part.target === 'external') {
            expect(part.href.startsWith('https://')).toBe(true);
          }
        }
        // Nothing is left half-parsed: no stray brackets or braces in the plain text.
        const text = parseInline(clause.text, urls)
          .filter((part) => part.kind === 'text')
          .map((part) => part.text)
          .join('');
        expect(text).not.toMatch(/[[\]{}]/);
      }
    },
  );

  it.each(documents.map((document) => [document.locale, document] as const))(
    'says what the draft says: not medical, a beta, no liability for gross negligence (%s)',
    (_, document) => {
      const all = JSON.stringify(document.clauses);
      expect(all).toMatch(/medical device|dispositivo médico/);
      expect(all).toMatch(/as is|como está/);
      expect(all).toMatch(/gross negligence|culpa grave/);
      expect(all).toMatch(/AGPL-3\.0/);
    },
  );
});

describe('the /terms page', () => {
  it('opens without signing in, with the title, the version line and every clause', async () => {
    const { auth } = renderTerms();

    expect(await screen.findByRole('heading', { level: 1, name: 'Terms of use' })).toBeTruthy();
    const date = formatDate(TERMS_LAST_UPDATED, 'dayMonthYear', 'en');
    expect(screen.getByText(`Version ${TERMS_VERSION}, last updated on ${date}.`)).toBeTruthy();
    expect(
      screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent),
    ).toEqual(TERMS_DOCUMENTS.en.clauses.map((clause) => clause.title));
    expect(auth.login).not.toHaveBeenCalled();
    expect(document.title).toBe('Terms of use · Lotties');
  });

  it('links the privacy policy and the source, and names who runs the service', async () => {
    renderTerms();

    const list = (await screen.findAllByRole('listitem')).find((item) => item.id === 'terms-data');
    expect(within(list!).getByRole('link', { name: 'Privacy policy' }).getAttribute('href')).toBe(
      '/privacy',
    );
    expect(screen.getByText(/run by the Lotties project maintainers/)).toBeTruthy();
    expect(screen.getByRole('link', { name: /the project repository/ }).getAttribute('href')).toBe(
      SOURCE_REPOSITORY,
    );
  });

  it('shows in Brazilian Portuguese', async () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'pt-BR');
    renderTerms();

    expect(await screen.findByRole('heading', { level: 1, name: 'Termos de uso' })).toBeTruthy();
    const date = formatDate(TERMS_LAST_UPDATED, 'dayMonthYear', 'pt-BR');
    expect(screen.getByText(`Versão ${TERMS_VERSION}, atualizada em ${date}.`)).toBeTruthy();
    expect(screen.getByText('Fase de teste')).toBeTruthy();
    expect(document.documentElement.lang).toBe('pt-BR');
  });

  it.each(['light', 'dark'])('has no accessibility violations (%s)', async (mode) => {
    window.localStorage.setItem(THEME_STORAGE_KEY, mode);
    const { container } = renderTerms();
    await screen.findByRole('heading', { level: 1, name: 'Terms of use' });

    const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });

    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });
});
