import { screen, waitFor, fireEvent } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppRoutes } from '../AppRoutes';
import type { BabyRoutineDb } from '../db/database';
import { testDatabase } from '../test/fakeApi';
import { useTestLocale } from '../test/locale';
import { renderWithDb } from '../test/renderApp';
import { nightPeriodKey } from '../theme/nightFeed';
import { NIGHT_FEED_STATE_STORAGE_KEY } from '../theme/nightFeedStorage';
import { THEME_STORAGE_KEY } from '../theme/themeStorage';
import UiGallery from './UiGallery';

/** The gallery renders every component and axe walks all of it. */
const SLOW = 60_000;

let db: BabyRoutineDb;

beforeEach(() => {
  db = testDatabase();
});

afterEach(async () => {
  await db.delete();
});

function chooseScheme(scheme: 'light' | 'dark' | 'night') {
  if (scheme === 'night') {
    window.localStorage.setItem(
      NIGHT_FEED_STATE_STORAGE_KEY,
      JSON.stringify({ override: { on: true, key: nightPeriodKey(new Date()) } }),
    );
  } else {
    window.localStorage.setItem(THEME_STORAGE_KEY, scheme);
  }
}

async function settleGallery() {
  await screen.findByRole('group', { name: /^(Medications|Remédios)/ });
  await screen.findAllByRole('checkbox');
  await screen.findAllByRole('group', { name: /^Birth date/ });
  await waitFor(() => expect(screen.queryByLabelText('Loading the date field')).toBeNull());
}

async function violations() {
  const result = await axe.run(document.body, {
    runOnly: ['wcag2a', 'wcag2aa'],
    // Contrast needs real rendering: it is checked per token by theme/tokens.test.ts.
    rules: { 'color-contrast': { enabled: false } },
  });
  return result.violations.map(
    (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`,
  );
}

describe.each(['light', 'dark', 'night'] as const)('UI gallery in the %s scheme', (scheme) => {
  it(
    'shows every component without accessibility violations',
    async () => {
      chooseScheme(scheme);
      renderWithDb(db, <UiGallery db={db} />);
      await settleGallery();
      expect(document.documentElement.hasAttribute(`data-${scheme}`)).toBe(true);
      expect(await violations()).toEqual([]);
    },
    SLOW,
  );
});

describe('UI gallery in Portuguese', () => {
  it(
    'has no accessibility violations and shows translated components',
    async () => {
      await useTestLocale('pt-BR');
      renderWithDb(db, <UiGallery db={db} />);
      await settleGallery();
      expect(screen.getAllByRole('button', { name: 'Aumentar' }).length).toBeGreaterThan(0);
      expect(await violations()).toEqual([]);
    },
    SLOW,
  );
});

describe('UI gallery toolbar', () => {
  it('switches scheme and language', async () => {
    renderWithDb(db, <UiGallery db={db} />);
    await settleGallery();
    fireEvent.click(screen.getByRole('radio', { name: 'Night' }));
    await waitFor(() => expect(document.documentElement.hasAttribute('data-night')).toBe(true));
    fireEvent.click(screen.getByRole('radio', { name: 'Light' }));
    await waitFor(() => expect(document.documentElement.hasAttribute('data-light')).toBe(true));
    fireEvent.click(screen.getByRole('radio', { name: 'Português' }));
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: 'Aumentar' }).length).toBeGreaterThan(0),
    );
  });
});

describe('route', () => {
  it('is registered at /dev/ui in development, outside the signed-in shell', async () => {
    expect(import.meta.env.DEV).toBe(true);
    renderWithDb(db, <AppRoutes />, { route: '/dev/ui' });
    expect(await screen.findByRole('heading', { name: 'UI gallery' })).toBeTruthy();
  });
});
