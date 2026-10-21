import { fireEvent, screen } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppRoutes } from '../AppRoutes';
import type { BabyRoutineDb } from '../db/database';
import { testDatabase } from '../test/fakeApi';
import { renderWithDb } from '../test/renderApp';
import { ILLUSTRATION_NAMES } from '../ui/illustrations';

/** The gallery draws 255 illustrations and axe walks all of them. */
const SLOW = 60_000;

let db: BabyRoutineDb;

beforeEach(() => {
  db = testDatabase();
});

afterEach(async () => {
  await db.delete();
});

async function violations() {
  const result = await axe.run(document.body, {
    runOnly: ['wcag2a', 'wcag2aa'],
    // Contrast needs real rendering: illustrations.test.ts checks the main shapes per scheme.
    rules: { 'color-contrast': { enabled: false } },
  });
  return result.violations.map(
    (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`,
  );
}

describe('illustration gallery', () => {
  it(
    'is registered at /dev/illustrations and shows every illustration in three schemes',
    async () => {
      renderWithDb(db, <AppRoutes />, { route: '/dev/illustrations' });
      expect(await screen.findByRole('heading', { name: 'Illustrations' })).toBeTruthy();
      for (const scheme of ['Light', 'Dark', 'Night']) {
        expect(screen.getByRole('region', { name: `${scheme} scheme` })).toBeTruthy();
      }
      const rows = document.querySelectorAll('[data-illustration-row]');
      expect(rows.length).toBe(ILLUSTRATION_NAMES.length * 3);
      expect(document.querySelectorAll('svg[data-illustration]').length).toBe(rows.length * 5);
      // One titled hero per row; the smaller copies are decorative.
      expect(screen.getAllByRole('img').length).toBe(rows.length);
    },
    SLOW,
  );

  it(
    'has no accessibility violations on the tint and on the surface',
    async () => {
      renderWithDb(db, <AppRoutes />, { route: '/dev/illustrations?bg=tint&glow=1' });
      await screen.findByRole('heading', { name: 'Illustrations' });
      expect(await violations()).toEqual([]);
      fireEvent.click(screen.getByRole('radio', { name: 'On surface' }));
      fireEvent.click(screen.getByRole('radio', { name: 'No glow' }));
      expect(await violations()).toEqual([]);
    },
    SLOW,
  );
});
