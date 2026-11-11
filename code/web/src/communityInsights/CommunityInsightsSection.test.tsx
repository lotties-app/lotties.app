import axe from 'axe-core';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BabyRoutineDb } from '../db/database';
import type { Baby, BabyRole } from '../db/models';
import en from '../i18n/locales/en/communityInsights.json';
import ptBR from '../i18n/locales/pt-BR/communityInsights.json';
import { activateLocale } from '../i18n/i18n';
import { findForbiddenClaims } from '../legal/forbiddenClaims';
import { useTestLocale } from '../test/locale';
import { fakeApi, httpError, testDatabase, type ApiCall } from '../test/fakeApi';
import { renderWithDb, settleSync } from '../test/renderApp';
import { THEME_STORAGE_KEY } from '../theme/themeStorage';
import type { CommunityConsentView } from './communityConsentApi';
import { CommunityInsightsSection } from './CommunityInsightsSection';

/* Settings > Community insights: the per-baby consent (docs/design/34 section 3, task T2). */

let db: BabyRoutineDb;

beforeEach(() => {
  db = testDatabase();
  window.localStorage.clear();
});

afterEach(async () => {
  await settleSync();
  await db.delete();
  await activateLocale('en');
});

const OWNER: Baby = { id: 'baby-1', name: 'Lia', birthDate: '2026-08-01', role: 'Owner' };
const PATH = '/api/v1/babies/baby-1/community-consent';

const view = (overrides: Partial<CommunityConsentView> = {}): CommunityConsentView => ({
  status: 'none',
  currentTextVersion: 'ci-1',
  latest: null,
  history: [],
  ...overrides,
});

const ON = view({
  status: 'on',
  latest: {
    action: 'granted',
    at: '2026-11-03T10:00:00Z',
    textVersion: 'ci-1',
    policyVersion: '9',
    byName: 'Ana',
    byMe: false,
  },
});

function render(handler: (call: ApiCall) => unknown, baby: Baby = OWNER) {
  const fake = fakeApi(handler);
  const result = renderWithDb(db, <CommunityInsightsSection baby={baby} expanded />, {
    api: fake.api,
  });
  return { ...fake, ...result };
}

/** A server that keeps the state and answers PUTs like the API does. */
function server(initial: CommunityConsentView = view()) {
  let current = initial;
  return (call: ApiCall) => {
    if (call.path !== PATH) return undefined;
    if (call.method === 'PUT') {
      const body = call.body as { granted: boolean };
      current = body.granted
        ? { ...ON, latest: { ...ON.latest!, byMe: true } }
        : view({
            status: 'off',
            latest: { ...ON.latest!, action: 'withdrawn', byMe: true },
          });
    }
    return current;
  };
}

const click = (name: RegExp | string) => fireEvent.click(screen.getByRole('button', { name }));

describe('community insights section', () => {
  it('shows nothing at all when the server hides the feature (404)', async () => {
    const { calls } = render((call) => {
      if (call.path === PATH) throw httpError(404);
    });
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(screen.queryByText('Community insights')).toBeNull();
    expect(document.body.textContent).toBe('');
  });

  it.each<BabyRole>(['Caregiver', 'Viewer', 'Doctor'])(
    'asks nothing and shows nothing to a %s',
    async (role) => {
      const { calls } = render(server(), { ...OWNER, role });
      await settleSync();
      expect(calls).toHaveLength(0);
      expect(document.body.textContent).toBe('');
    },
  );

  it('turns on only after both declarations, sending the text version it showed', async () => {
    const { calls } = render(server());
    expect(await screen.findByText('Off for Lia.')).toBeTruthy();
    click('Turn on…');
    expect(
      screen.getByText(/We only publish numbers for groups of at least 20 babies/),
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: 'privacy policy' }).getAttribute('href')).toBe(
      '/privacy#privacy-community-insights',
    );
    const turnOn = screen.getByRole('button', { name: 'Turn on for Lia' });
    expect(turnOn).toHaveProperty('disabled', true);
    fireEvent.click(screen.getByRole('checkbox', { name: "I am Lia's parent or legal guardian." }));
    expect(turnOn).toHaveProperty('disabled', true);
    fireEvent.click(screen.getByRole('checkbox', { name: /I agree that Lia's records/ }));
    expect(calls.some((c) => c.method === 'PUT')).toBe(false);

    fireEvent.click(turnOn);

    expect(await screen.findByText(/on for Lia since .* \(turned on by you\)/)).toBeTruthy();
    expect(calls.find((c) => c.method === 'PUT')!.body).toEqual({
      granted: true,
      textVersion: 'ci-1',
      guardianConfirmed: true,
      locale: 'en',
    });
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('"Not now" closes the screen and records nothing', async () => {
    const { calls } = render(server());
    await screen.findByText('Off for Lia.');
    click('Turn on…');
    click('Not now');
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(calls.some((c) => c.method === 'PUT')).toBe(false);
  });

  it('shows who turned it on and turns it off with one tap', async () => {
    const { calls } = render(server(ON));
    expect(await screen.findByText(/on for Lia since .* \(turned on by Ana\)/)).toBeTruthy();

    click('Turn off');

    expect(await screen.findByText(/Off for Lia since .* \(turned off by you\)/)).toBeTruthy();
    expect(calls.find((c) => c.method === 'PUT')!.body).toEqual({ granted: false, locale: 'en' });
  });

  it('says a changed text needs a new yes', async () => {
    render(server(view({ status: 'renewal_needed', latest: ON.latest })));
    expect(await screen.findByText(/The text changed since it was turned on/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Turn on…' })).toBeTruthy();
  });

  it('explains a refused yes for an older text', async () => {
    render((call) => {
      if (call.path !== PATH) return undefined;
      if (call.method === 'PUT') throw httpError(409, 'community_consent_version_outdated');
      return view();
    });
    await screen.findByText('Off for Lia.');
    click('Turn on…');
    fireEvent.click(screen.getByRole('checkbox', { name: /parent or legal guardian/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /I agree/ }));
    click('Turn on for Lia');
    expect(
      await screen.findByText('This text changed. Reload the app and read the current one.'),
    ).toBeTruthy();
  });

  it('speaks Brazilian Portuguese', async () => {
    await useTestLocale('pt-BR');
    render(server());
    expect(await screen.findByText('Desativado para Lia.')).toBeTruthy();
    click('Ativar…');
    expect(
      screen.getByRole('checkbox', { name: 'Sou o pai, a mãe ou o responsável legal de Lia.' }),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Ativar para Lia' })).toBeTruthy();
  });

  it.each(['dark', 'light'])('has no accessibility violations (%s)', async (mode) => {
    window.localStorage.setItem(THEME_STORAGE_KEY, mode);
    const { container } = render(server());
    await screen.findByText('Off for Lia.');
    click('Turn on…');
    const results = await axe.run(container, {
      runOnly: ['wcag2a', 'wcag2aa'],
      rules: { 'color-contrast': { enabled: false } },
    });
    expect(results.violations.map((v) => v.id)).toEqual([]);
  });
});

describe('the wording', () => {
  it.each([
    ['en', en],
    ['pt-BR', ptBR],
  ] as const)('claims nothing Lotties does not do (%s)', (locale, catalog) => {
    expect(findForbiddenClaims(JSON.stringify(catalog), locale)).toEqual([]);
  });
});
