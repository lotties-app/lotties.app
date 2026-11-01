import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import axe from 'axe-core';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppRoutes } from '../AppRoutes';
import type { BabyRoutineDb } from '../db/database';
import { I18nProvider } from '../i18n/I18nProvider';
import { LOCALE_STORAGE_KEY } from '../i18n/localeStorage';
import { PublicTopBar } from '../landing/PublicTopBar';
import { testDatabase } from '../test/fakeApi';
import { fakeAuth } from '../test/fakeAuth';
import { renderWithDb, settleSync } from '../test/renderApp';
import { seedBaby } from '../test/seed';
import { THEME_STORAGE_KEY } from '../theme/themeStorage';
import { UA } from './installTestKit';
import type { InstallState } from './useInstallState';

/* The public /install page, the Hub's copy of it, /welcome and the public pages' Back. */

let override: Partial<InstallState> = {};
vi.mock('./useInstallState', async (importOriginal) => {
  const real = await importOriginal<typeof import('./useInstallState')>();
  return { useInstallState: () => ({ ...real.useInstallState(), ...override }) };
});

let db: BabyRoutineDb;

function setUserAgent(ua: string, touchPoints = 0) {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(ua);
  Object.defineProperty(navigator, 'maxTouchPoints', { value: touchPoints, configurable: true });
}

const signedOut = () => fakeAuth({ isAuthenticated: false, user: null });

beforeEach(() => {
  db = testDatabase();
  override = {};
  window.localStorage.clear();
  setUserAgent(UA.androidChrome, 5);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await settleSync();
  await db.delete();
});

const sectionButton = (name: string) => screen.getByRole('button', { name });

describe('the public /install route', () => {
  it('opens without signing in, with the public top bar', async () => {
    const auth = signedOut();
    renderWithDb(db, <AppRoutes />, { auth, route: '/install' });
    expect(await screen.findByRole('heading', { level: 1, name: 'Install Lotties' })).toBeTruthy();
    expect(auth.login).not.toHaveBeenCalled();
    const bar = screen.getByRole('banner');
    expect(within(bar).getByRole('button', { name: 'Back' })).toBeTruthy();
    expect(within(bar).getByRole('link', { name: 'Home' }).getAttribute('href')).toBe('/');
    await waitFor(() => expect(document.title).toBe('Install Lotties · Lotties'));
  });

  it('shows every platform, the detected one first and open (Android)', async () => {
    renderWithDb(db, <AppRoutes />, { auth: signedOut(), route: '/install' });
    await screen.findByRole('heading', { level: 1 });
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(['Android', 'iPhone and iPad', 'Computer', 'Troubleshooting']);
    expect(sectionButton('Android').getAttribute('aria-expanded')).toBe('true');
    expect(sectionButton('iPhone and iPad').getAttribute('aria-expanded')).toBe('false');
    // Ordered steps, the other browsers folded away.
    const other = screen.getByRole('button', { name: 'Other browsers' });
    expect(other.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(other);
    expect(other.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('heading', { level: 4, name: 'Samsung Internet' })).toBeTruthy();
    expect(screen.getByText('Tap the menu (three dots) at the top right.')).toBeTruthy();
    expect(screen.getByText(/allow notifications when Lotties asks/)).toBeTruthy();
    // Opening another section keeps the first open.
    fireEvent.click(sectionButton('iPhone and iPad'));
    expect(sectionButton('iPhone and iPad').getAttribute('aria-expanded')).toBe('true');
    expect(sectionButton('Android').getAttribute('aria-expanded')).toBe('true');
    expect(
      screen.getByText(/notifications only work in the app added to the Home Screen/),
    ).toBeTruthy();
  });

  it('puts iPhone and iPad first on an iPhone', async () => {
    setUserAgent(UA.iosSafari, 5);
    renderWithDb(db, <AppRoutes />, { auth: signedOut(), route: '/install' });
    await screen.findByRole('heading', { level: 1 });
    expect(screen.getAllByRole('heading', { level: 2 })[0].textContent).toBe('iPhone and iPad');
    expect(sectionButton('iPhone and iPad').getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('button', { name: 'Add to Home Screen' })).toBeTruthy();
  });

  it('puts Computer first on a desktop browser', async () => {
    setUserAgent(UA.desktopEdge);
    renderWithDb(db, <AppRoutes />, { auth: signedOut(), route: '/install' });
    await screen.findByRole('heading', { level: 1 });
    expect(screen.getAllByRole('heading', { level: 2 })[0].textContent).toBe('Computer');
  });

  it('offers the real Install button at the top when the browser fires its prompt', async () => {
    renderWithDb(db, <AppRoutes />, { auth: signedOut(), route: '/install' });
    await screen.findByRole('heading', { level: 1 });
    const event = new Event('beforeinstallprompt', { cancelable: true });
    const prompt = vi.fn().mockResolvedValue(undefined);
    Object.assign(event, {
      platforms: ['web'],
      prompt,
      userChoice: Promise.resolve({ outcome: 'accepted', platform: 'web' }),
    });
    act(() => {
      window.dispatchEvent(event);
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Install app' }));
    await waitFor(() => expect(prompt).toHaveBeenCalledTimes(1));
  });

  it('says it is already installed, with only the update and uninstall answers', async () => {
    override = { installed: true };
    renderWithDb(db, <AppRoutes />, { auth: signedOut(), route: '/install' });
    expect(await screen.findByText('You are already using the installed app.')).toBeTruthy();
    expect(screen.queryByRole('heading', { level: 2, name: 'Android' })).toBeNull();
    expect(screen.getByRole('heading', { level: 3, name: 'How do I update?' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Install app|How to install/ })).toBeNull();
  });

  it('shows nothing install-related inside the store app', async () => {
    override = { native: true };
    renderWithDb(db, <AppRoutes />, { auth: signedOut(), route: '/install' });
    expect(
      await screen.findByText('You are using the Lotties app. There is nothing to install.'),
    ).toBeTruthy();
    expect(screen.queryAllByRole('heading', { level: 2 })).toHaveLength(0);
  });

  it('shows the page in Portuguese', async () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'pt-BR');
    renderWithDb(db, <AppRoutes />, { auth: signedOut(), route: '/install' });
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Instalar o Lotties' }),
    ).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 2, name: 'Problemas comuns' })).toBeTruthy(),
    );
  });
});

describe('inside the app', () => {
  it('Hub > Install the app opens the same guide in the shell, with the way back to the Hub', async () => {
    await seedBaby(db);
    renderWithDb(db, <AppRoutes />, { route: '/hub' });
    const row = await screen.findByTestId('hub-row-install');
    expect(row.getAttribute('href')).toBe('/hub/install');
    fireEvent.click(row);
    expect(await screen.findByRole('heading', { level: 1, name: 'Install Lotties' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Back to Hub' })).toBeTruthy();
    expect(screen.getByRole('navigation')).toBeTruthy();
  });

  it('Hub > Home page opens the landing page with Back to the app', async () => {
    await seedBaby(db);
    renderWithDb(db, <AppRoutes />, { route: '/hub' });
    const row = await screen.findByTestId('hub-row-welcome');
    expect(row.getAttribute('href')).toBe('/welcome');
    fireEvent.click(row);
    expect(
      await screen.findByRole('heading', { level: 1, name: /Track your baby.s day, together/ }),
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Back to the app' }).getAttribute('href')).toBe('/');
    expect(screen.queryByRole('button', { name: 'Sign in' })).toBeNull();
  });

  it('keeps / opening the app when signed in', async () => {
    await seedBaby(db);
    renderWithDb(db, <AppRoutes />, { route: '/' });
    expect(await screen.findByRole('heading', { name: 'Now' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Back to the app' })).toBeNull();
  });

  it('sends a signed-out visitor of /welcome to the landing page at /', async () => {
    const auth = signedOut();
    renderWithDb(db, <AppRoutes />, { auth, route: '/welcome' });
    expect(
      await screen.findByRole('heading', { level: 1, name: /Track your baby.s day, together/ }),
    ).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Sign in' }).length).toBeGreaterThan(0);
    expect(auth.login).not.toHaveBeenCalled();
  });
});

describe('the public top bar', () => {
  function renderBar(entries: string[]) {
    return render(
      <I18nProvider>
        <MemoryRouter initialEntries={entries} initialIndex={entries.length - 1}>
          <Routes>
            <Route path="/" element={<p>Home route</p>} />
            <Route path="/hub" element={<p>The Hub</p>} />
            <Route path="/install" element={<PublicTopBar />} />
          </Routes>
        </MemoryRouter>
      </I18nProvider>,
    );
  }

  it('goes back in the app history when there is one', async () => {
    renderBar(['/hub', '/install']);
    fireEvent.click(await screen.findByRole('button', { name: 'Back' }));
    expect(await screen.findByText('The Hub')).toBeTruthy();
  });

  it('goes to the home route when the page was opened directly', async () => {
    renderBar(['/install']);
    fireEvent.click(await screen.findByRole('button', { name: 'Back' }));
    expect(await screen.findByText('Home route')).toBeTruthy();
  });

  it('always has Home and the brand going to /', async () => {
    renderBar(['/install']);
    expect((await screen.findByRole('link', { name: 'Home' })).getAttribute('href')).toBe('/');
    expect(screen.getByRole('link', { name: 'Lotties home' }).getAttribute('href')).toBe('/');
  });
});

describe.each([
  ['light', 'en'],
  ['dark', 'en'],
  ['light', 'pt-BR'],
  ['dark', 'pt-BR'],
] as const)('the install page in the %s scheme, %s', (scheme, locale) => {
  it('has no accessibility violations, with sections and the steps sheet open', async () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, scheme);
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    const { container } = renderWithDb(db, <AppRoutes />, { auth: signedOut(), route: '/install' });
    await screen.findByRole('heading', { level: 1 });
    await waitFor(() => expect(screen.getAllByRole('heading', { level: 2 }).length).toBe(4));
    for (const button of screen.getAllByRole('button', { expanded: false }))
      fireEvent.click(button);
    expect(document.documentElement.hasAttribute(`data-${scheme}`)).toBe(true);
    const page = await axe.run(container, {
      runOnly: ['wcag2a', 'wcag2aa'],
      rules: { 'color-contrast': { enabled: false } },
    });
    expect(page.violations.map((v) => `${v.id}: ${v.nodes[0]?.html}`)).toEqual([]);

    fireEvent.click(screen.getByRole('button', { name: /How to install|Como instalar/ }));
    const dialog = await screen.findByRole('dialog');
    const sheet = await axe.run(dialog, {
      runOnly: ['wcag2a', 'wcag2aa'],
      rules: { 'color-contrast': { enabled: false } },
    });
    expect(sheet.violations.map((v) => `${v.id}: ${v.nodes[0]?.html}`)).toEqual([]);
  });
});
