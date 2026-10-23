import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppRoutes } from '../AppRoutes';
import type { BabyRoutineDb } from '../db/database';
import { fakeApi, testDatabase } from '../test/fakeApi';
import { renderWithDb, settleSync } from '../test/renderApp';
import { seedBaby } from '../test/seed';
import { nightPeriodKey } from '../theme/nightFeed';
import { NIGHT_FEED_STATE_STORAGE_KEY } from '../theme/nightFeedStorage';
import { THEME_STORAGE_KEY } from '../theme/themeStorage';
import { useTestLocale } from '../test/locale';

let db: BabyRoutineDb;

beforeEach(() => {
  db = testDatabase();
});

afterEach(async () => {
  vi.useRealTimers();
  await settleSync();
  await db.delete();
});

const renderShell = (route = '/', api = fakeApi().api) =>
  renderWithDb(db, <AppRoutes />, { route, api });

describe('header', () => {
  it('shows the baby avatar initial, name and age line', async () => {
    // Lia's age is a count of days, weeks or months only while she is under a year old: pin the date.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 21, 14, 0));
    await seedBaby(db);
    renderShell();
    const header = await screen.findByRole('banner');
    expect(await within(header).findByText('Lia')).toBeTruthy();
    expect(within(header).getByText(/^\d+ (day|week|month)s?/)).toBeTruthy();
    expect(within(header).getByText('L')).toBeTruthy();
    // One baby: static heading, no switcher button.
    expect(within(header).queryByRole('button', { name: /switch baby/ })).toBeNull();
  });

  it('offers the baby switcher with more than one baby', async () => {
    await seedBaby(db);
    await db.babies.put({ id: 'baby-2', name: 'Theo', birthDate: '2026-02-01', role: 'Parent' });
    renderShell();
    fireEvent.click(await screen.findByRole('button', { name: 'Lia, switch baby' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /Theo/ }));
    expect(await screen.findByRole('button', { name: 'Theo, switch baby' })).toBeTruthy();
  });

  it('links the sync icon to Settings > Sync, and opens the Sync section', async () => {
    await seedBaby(db);
    renderShell();
    const link = await screen.findByRole('link', { name: /^Sync: .*Open sync settings$/ });
    expect(link.getAttribute('href')).toBe('/settings#sync');
    fireEvent.click(link);
    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeTruthy();
    expect(await screen.findByText(/^Status:/)).toBeTruthy();
  });
});

describe('night view quick toggle', () => {
  it('switches the night view on and off from the account menu', async () => {
    await seedBaby(db);
    renderShell();
    fireEvent.click(await screen.findByRole('button', { name: 'User menu' }));
    const item = await screen.findByRole('menuitemcheckbox', { name: 'Night view' });
    expect(item.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(item);
    expect(document.documentElement.hasAttribute('data-night')).toBe(true);
    // The menu stays open so the switch shows the new state.
    const on = await screen.findByRole('menuitemcheckbox', { name: 'Night view' });
    expect(on.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(on);
    expect(document.documentElement.hasAttribute('data-night')).toBe(false);
  });
});

describe('bottom navigation', () => {
  const tabs = ['Now', 'Day', 'Insights', 'Hub'];

  it('has Now, Day, Insights and Hub links, and the round Add event button apart from the dock', async () => {
    await seedBaby(db);
    renderShell('/');
    const nav = await screen.findByRole('navigation', { name: 'Main' });
    expect(
      within(nav)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(tabs);
    expect(within(nav).getByRole('link', { name: 'Now' }).getAttribute('href')).toBe('/');
    expect(within(nav).getByRole('link', { name: 'Day' }).getAttribute('href')).toBe('/day');
    expect(within(nav).getByRole('link', { name: 'Insights' }).getAttribute('href')).toBe(
      '/insights',
    );
    expect(within(nav).getByRole('link', { name: 'Hub' }).getAttribute('href')).toBe('/hub');
    // The "+" is a separate round button after the dock, not inside the navigation landmark.
    const add = await screen.findByTestId('quick-add');
    expect(nav.contains(add)).toBe(false);
    expect(nav.compareDocumentPosition(add)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it.each([
    ['/', 'Now'],
    ['/day', 'Day'],
    ['/insights', 'Insights'],
  ])('opens the More sheet from the Add event button on %s (%s)', async (route, tab) => {
    await seedBaby(db);
    renderShell(route);
    // The screen listens once it has loaded.
    await screen.findByRole('heading', { name: tab, level: 1 });
    await screen.findByRole('navigation', { name: 'Main' });
    fireEvent.click(await screen.findByTestId('quick-add'));
    const sheet = await screen.findByRole('dialog', { name: 'More' });
    expect(within(sheet).getByTestId('more-grid')).toBeTruthy();
    fireEvent.keyDown(sheet, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'More' })).toBeNull());
    // And again: a second press opens it a second time.
    fireEvent.click(screen.getByTestId('quick-add'));
    expect(await screen.findByRole('dialog', { name: 'More' })).toBeTruthy();
  });

  it.each([
    ['/', 'Now'],
    ['/day', 'Day'],
    ['/insights', 'Insights'],
    ['/hub', 'Hub'],
    ['/settings', 'Hub'],
    ['/settings#sync', 'Hub'],
    ['/vaccines', 'Hub'],
    ['/notes', 'Hub'],
  ])(
    'marks the current tab on %s (%s) and puts the pill behind its icon',
    async (route, current) => {
      await seedBaby(db);
      renderShell(route);
      const nav = await screen.findByRole('navigation', { name: 'Main' });
      for (const name of tabs) {
        const link = within(nav).getByRole('link', { name });
        expect(link.getAttribute('aria-current')).toBe(name === current ? 'page' : null);
        expect(link.querySelector('[data-active-indicator]') !== null).toBe(name === current);
      }
    },
  );

  it('keeps the old routes working: /timeline goes to Day and /growth to Insights', async () => {
    await seedBaby(db);
    const first = renderShell('/timeline');
    expect(await screen.findByRole('heading', { name: 'Day' })).toBeTruthy();
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(within(nav).getByRole('link', { name: 'Day' }).getAttribute('aria-current')).toBe(
      'page',
    );
    first.unmount();

    renderShell('/growth');
    expect(await screen.findByRole('heading', { name: 'Insights', level: 1 })).toBeTruthy();
    expect(await screen.findByRole('heading', { name: 'More insights are coming' })).toBeTruthy();
    expect(await screen.findByRole('heading', { name: 'Growth', level: 2 })).toBeTruthy();
  });

  it('navigates between the tabs', async () => {
    await seedBaby(db);
    renderShell('/');
    const nav = await screen.findByRole('navigation', { name: 'Main' });
    fireEvent.click(within(nav).getByRole('link', { name: 'Day' }));
    expect(await screen.findByRole('heading', { name: 'Day' })).toBeTruthy();
    fireEvent.click(within(nav).getByRole('link', { name: 'Insights' }));
    expect(await screen.findByRole('heading', { name: 'Insights', level: 1 })).toBeTruthy();
    fireEvent.click(within(nav).getByRole('link', { name: 'Hub' }));
    expect(await screen.findByRole('heading', { name: 'Hub', level: 1 })).toBeTruthy();
    expect(within(nav).getByRole('link', { name: 'Hub' }).getAttribute('aria-current')).toBe(
      'page',
    );
    fireEvent.click(within(nav).getByRole('link', { name: 'Now' }));
    expect(await screen.findByRole('heading', { name: 'Now' })).toBeTruthy();
  });

  it('labels the tabs in Portuguese (the Hub is "Central")', async () => {
    await useTestLocale('pt-BR');
    await seedBaby(db);
    renderShell('/');
    const nav = await screen.findByRole('navigation', { name: 'Principal' });
    expect(
      within(nav)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['Agora', 'Dia', 'Insights', 'Central']);
    expect(await screen.findByTestId('quick-add')).toBeTruthy();
  });

  it('stays visible for viewers (write actions are disabled on the screens, not hidden here)', async () => {
    await seedBaby(db, { role: 'Viewer' });
    renderShell('/');
    const nav = await screen.findByRole('navigation', { name: 'Main' });
    expect(within(nav).getAllByRole('link')).toHaveLength(4);
    // Viewers cannot log, so there is no "+".
    expect(screen.queryByTestId('quick-add')).toBeNull();
    expect(await screen.findByText(/view-only access/)).toBeTruthy();
  });

  it('is visible with no baby too, and sits above the home indicator', async () => {
    renderShell('/');
    const nav = await screen.findByRole('navigation', { name: 'Main' });
    expect(within(nav).getAllByRole('link')).toHaveLength(4);
    expect(screen.queryByTestId('quick-add')).toBeNull();
    // The Hub works before the first baby too, like the other tabs.
    fireEvent.click(within(nav).getByRole('link', { name: 'Hub' }));
    expect(await screen.findByRole('heading', { name: 'Hub', level: 1 })).toBeTruthy();
    const styles = Array.from(document.querySelectorAll('style'), (node) => node.textContent).join(
      '',
    );
    expect(styles).toContain('padding-bottom:calc(12px + env(safe-area-inset-bottom))');
  });
});

describe('account menu', () => {
  it('has Baby profile, Settings, Appearance and language, Night view and Log out', async () => {
    await seedBaby(db);
    renderShell('/');
    await within(await screen.findByRole('banner')).findByText('Lia');
    fireEvent.click(await screen.findByRole('button', { name: 'User menu' }));
    const menu = await screen.findByRole('menu');
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent),
    ).toEqual(['Ana', 'Baby profile', 'Settings', 'Appearance and language', 'Log out']);
    expect(within(menu).getByRole('menuitemcheckbox', { name: 'Night view' })).toBeTruthy();
  });

  it('Baby profile opens Settings with the baby section expanded', async () => {
    await seedBaby(db);
    renderShell('/');
    await within(await screen.findByRole('banner')).findByText('Lia');
    fireEvent.click(await screen.findByRole('button', { name: 'User menu' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Baby profile' }));

    expect(await screen.findByRole('heading', { name: 'Settings', level: 1 })).toBeTruthy();
    const header = await screen.findByRole('button', { name: 'Baby' });
    expect(header.getAttribute('aria-expanded')).toBe('true');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('Settings opens the page, Appearance and language opens those sections', async () => {
    await seedBaby(db);
    renderShell('/');
    fireEvent.click(await screen.findByRole('button', { name: 'User menu' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Settings' }));
    expect(await screen.findByRole('heading', { name: 'Settings', level: 1 })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'User menu' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Appearance and language' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Appearance' }).getAttribute('aria-expanded')).toBe(
        'true',
      ),
    );
    expect(screen.getByRole('button', { name: 'Language' }).getAttribute('aria-expanded')).toBe(
      'true',
    );
  });

  it('has no Baby profile entry without a baby', async () => {
    renderShell('/');
    fireEvent.click(await screen.findByRole('button', { name: 'User menu' }));
    const menu = await screen.findByRole('menu');
    expect(within(menu).queryByRole('menuitem', { name: 'Baby profile' })).toBeNull();
    expect(within(menu).getByRole('menuitem', { name: 'Settings' })).toBeTruthy();
  });
});

describe('accessibility (axe)', () => {
  async function violations() {
    const result = await axe.run(document.body, {
      runOnly: ['wcag2a', 'wcag2aa'],
      // jsdom has no layout or canvas, so contrast is checked by the token tests and by hand.
      rules: { 'color-contrast': { enabled: false } },
    });
    return result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(' | ')}`);
  }

  it.each(['dark', 'light', 'night'])(
    'the shell has no violations in the %s theme',
    async (mode) => {
      if (mode === 'night') {
        // An explicit "night view on" for the current period (the same state the quick toggle stores).
        window.localStorage.setItem(
          NIGHT_FEED_STATE_STORAGE_KEY,
          JSON.stringify({ override: { on: true, key: nightPeriodKey(new Date()) } }),
        );
      } else {
        window.localStorage.setItem(THEME_STORAGE_KEY, mode);
      }
      await seedBaby(db);
      renderShell();
      await screen.findByRole('region', {
        name: mode === 'night' ? 'Night view' : "Log Lia's first event",
      });
      expect(document.documentElement.hasAttribute(`data-${mode}`)).toBe(true);
      expect(await violations()).toEqual([]);
    },
  );

  it('has no violations on the Hub tab', async () => {
    await seedBaby(db);
    renderShell('/hub');
    await screen.findByRole('heading', { name: 'Hub', level: 1 });
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(within(nav).getByRole('link', { name: 'Hub' }).getAttribute('aria-current')).toBe(
      'page',
    );
    expect(await violations()).toEqual([]);
  });

  it('has no violations with the account menu open', async () => {
    await seedBaby(db);
    renderShell();
    fireEvent.click(await screen.findByRole('button', { name: 'User menu' }));
    await screen.findByRole('menu');
    expect(await violations()).toEqual([]);
  });
});
