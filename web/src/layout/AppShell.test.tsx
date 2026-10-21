import { fireEvent, screen, within } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppRoutes } from '../AppRoutes';
import type { BabyRoutineDb } from '../db/database';
import { fakeApi, testDatabase } from '../test/fakeApi';
import { renderWithDb, settleSync } from '../test/renderApp';
import { seedBaby } from '../test/seed';
import { nightPeriodKey } from '../theme/nightFeed';
import { NIGHT_FEED_STATE_STORAGE_KEY } from '../theme/nightFeedStorage';
import { THEME_STORAGE_KEY } from '../theme/themeStorage';

let db: BabyRoutineDb;

beforeEach(() => {
  db = testDatabase();
});

afterEach(async () => {
  await settleSync();
  await db.delete();
});

const renderShell = (route = '/', api = fakeApi().api) =>
  renderWithDb(db, <AppRoutes />, { route, api });

describe('header', () => {
  it('shows the baby avatar initial, name and age line', async () => {
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
  it('has Home, Timeline, Growth and Settings, with the current page marked', async () => {
    await seedBaby(db);
    renderShell('/timeline');
    const nav = await screen.findByRole('navigation', { name: 'Main' });
    for (const name of ['Home', 'Timeline', 'Growth', 'Settings']) {
      expect(within(nav).getByRole('link', { name })).toBeTruthy();
    }
    expect(within(nav).getByRole('link', { name: 'Timeline' }).getAttribute('aria-current')).toBe(
      'page',
    );
    expect(within(nav).getByRole('link', { name: 'Home' }).getAttribute('aria-current')).toBeNull();
  });

  it('opens and closes the Track sheet from the Add event button', async () => {
    await seedBaby(db);
    renderShell();
    const fab = await screen.findByRole('button', { name: 'Add event' });
    expect(fab.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(fab);
    expect(await screen.findByRole('heading', { name: 'Track' })).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('presentation'), { key: 'Escape' });
    await screen.findByRole('button', { name: 'Add event', hidden: true });
  });

  it('hides Add event for viewers and when there is no baby', async () => {
    await seedBaby(db, { role: 'Viewer' });
    const first = renderShell();
    await screen.findByRole('navigation', { name: 'Main' });
    await within(await screen.findByRole('banner')).findByText('Lia');
    expect(screen.queryByRole('button', { name: 'Add event' })).toBeNull();
    first.unmount();
    await db.babies.clear();
    renderShell();
    await screen.findByRole('navigation', { name: 'Main' });
    expect(screen.queryByRole('button', { name: 'Add event' })).toBeNull();
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
      await screen.findByRole('button', { name: /^Log Diaper/ });
      expect(document.documentElement.hasAttribute(`data-${mode}`)).toBe(true);
      expect(await violations()).toEqual([]);
    },
  );

  it('has no violations with the Track sheet open', async () => {
    await seedBaby(db);
    renderShell();
    fireEvent.click(await screen.findByRole('button', { name: 'Add event' }));
    await screen.findByRole('heading', { name: 'Track' });
    expect(await violations()).toEqual([]);
  });
});
