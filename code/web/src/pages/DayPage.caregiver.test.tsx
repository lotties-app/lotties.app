import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BabyRoutineDb } from '../db/database';
import type { BabyEvent, BabyRole } from '../db/models';
import { BABY_ID, fakeApi, testDatabase } from '../test/fakeApi';
import { useTestLocale } from '../test/locale';
import { renderWithDb, settleSync } from '../test/renderApp';
import { DIAPER, FEEDING, MEDICATION, seedBaby } from '../test/seed';
import { THEME_STORAGE_KEY } from '../theme/themeStorage';
import { DayPage } from './DayPage';

/*
 * The Day tab for a Caregiver (docs/SPEC.md "Roles and permissions"): their own entries open the
 * edit sheet; someone else's open read-only with "Added by", lose Stop, and a dose says who gave it.
 */

const ME = 'user-me';
const ANA = 'user-ana';

let db: BabyRoutineDb;

beforeEach(() => {
  db = testDatabase();
});

afterEach(async () => {
  await settleSync();
  window.localStorage.clear();
  await db.delete();
});

function at(h: number, m = 0): string {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m).toISOString();
}

function event(overrides: Partial<BabyEvent> & { id: string }): BabyEvent {
  return {
    babyId: BABY_ID,
    typeId: DIAPER,
    startedAt: at(0, 2),
    endedAt: at(0, 2),
    payload: { content: 'WET' },
    notes: null,
    createdBy: ME,
    createdAt: at(0, 2),
    updatedAt: at(0, 2),
    deletedAt: null,
    ...overrides,
  };
}

async function seed(role: BabyRole) {
  await seedBaby(db, { role, userId: ME, medications: true });
  await db.events.bulkPut([
    event({
      id: 'running',
      typeId: FEEDING,
      startedAt: at(0, 1),
      endedAt: null,
      payload: {},
      createdBy: ANA,
    }),
    event({ id: 'mine', startedAt: at(0, 2), endedAt: at(0, 2) }),
    event({
      id: 'anas-diaper',
      startedAt: at(0, 3),
      endedAt: at(0, 3),
      createdBy: ANA,
      notes: 'Rash cream',
    }),
    event({
      id: 'anas-dose',
      typeId: MEDICATION,
      startedAt: at(0, 4),
      endedAt: at(0, 4),
      payload: { medications: [{ medicationId: 'm-z', name: 'Zeta syrup' }] },
      createdBy: ANA,
    }),
    event({ id: 'unsynced', startedAt: at(0, 5), endedAt: at(0, 5), createdBy: null }),
  ]);
}

const api = () =>
  fakeApi((call) =>
    call.method === 'GET' && call.path.endsWith('/members')
      ? [
          { userId: ANA, displayName: 'Ana', role: 'Parent', joinedAt: '2026-10-01' },
          { userId: ME, displayName: 'Lu', role: 'Caregiver', joinedAt: '2026-10-02' },
        ]
      : undefined,
  ).api;

async function renderDay(listName = /^Today, /) {
  renderWithDb(db, <DayPage />, { api: api() });
  return screen.findByRole('list', { name: listName });
}

const rowOf = (list: HTMLElement, id: string) =>
  list.querySelector<HTMLElement>(`[data-event-id="${id}"]`)!;

async function violations() {
  const result = await axe.run(document.body, {
    runOnly: ['wcag2a', 'wcag2aa'],
    rules: { 'color-contrast': { enabled: false } },
  });
  return result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(' | ')}`);
}

describe('the Day tab for a caregiver', () => {
  it('names their own rows for editing and the others as view only, added by their author', async () => {
    await seed('Caregiver');
    const list = await renderDay();
    await waitFor(() =>
      expect(
        within(rowOf(list, 'anas-diaper')).getByRole('button').getAttribute('aria-label'),
      ).toMatch(/added by Ana \(view only\)$/),
    );
    for (const id of ['mine', 'unsynced']) {
      expect(within(rowOf(list, id)).getByRole('button').getAttribute('aria-label')).toMatch(
        /^Edit /,
      );
    }
  });

  it('opens someone else’s entry read-only, saying who added it, with nothing to save', async () => {
    await seed('Caregiver');
    const list = await renderDay();
    await within(rowOf(list, 'anas-diaper')).findByRole('button', { name: /added by Ana/ });
    fireEvent.click(within(rowOf(list, 'anas-diaper')).getByRole('button'));
    const sheet = await screen.findByRole('dialog');
    expect(
      within(sheet).getByText('Added by Ana. Only they or a parent can change it.'),
    ).toBeTruthy();
    expect(within(sheet).getByText('Rash cream')).toBeTruthy();
    expect(within(sheet).queryByRole('button', { name: 'Save' })).toBeNull();
    expect(within(sheet).queryByRole('button', { name: /Delete|More/ })).toBeNull();
  });

  it('opens their own entry in the edit sheet', async () => {
    await seed('Caregiver');
    const list = await renderDay();
    fireEvent.click(within(rowOf(list, 'mine')).getByRole('button'));
    const sheet = await screen.findByRole('dialog');
    expect(within(sheet).getByRole('button', { name: 'Save' })).toBeTruthy();
  });

  it('offers Stop for a timer someone else started, while the row itself opens read-only', async () => {
    await seed('Caregiver');
    const list = await renderDay();
    const running = rowOf(list, 'running');
    expect(within(running).getByText('Running')).toBeTruthy();
    expect(within(running).getByRole('button', { name: 'Stop Feeding' })).toBeTruthy();
    expect(
      await within(running).findByRole('button', { name: /added by Ana \(view only\)$/ }),
    ).toBeTruthy();
  });

  it('shows who gave a dose', async () => {
    await seed('Caregiver');
    const list = await renderDay();
    expect(await within(rowOf(list, 'anas-dose')).findByText('Given by Ana')).toBeTruthy();
  });

  it.each(['light', 'dark'])(
    'has no violations with the read-only sheet open (%s)',
    async (mode) => {
      window.localStorage.setItem(THEME_STORAGE_KEY, mode);
      await seed('Caregiver');
      const list = await renderDay();
      await within(rowOf(list, 'anas-dose')).findByText('Given by Ana');
      expect(await violations()).toEqual([]);
      fireEvent.click(within(rowOf(list, 'anas-dose')).getByRole('button'));
      const sheet = await screen.findByRole('dialog');
      expect(within(sheet).getByText('Given by Ana')).toBeTruthy();
      expect(await violations()).toEqual([]);
    },
  );
});

describe('the Day tab for a parent', () => {
  it('edits everyone’s entries and still says who gave a dose', async () => {
    await seed('Parent');
    const list = await renderDay();
    expect(await within(rowOf(list, 'anas-dose')).findByText('Given by Ana')).toBeTruthy();
    expect(
      within(rowOf(list, 'anas-diaper')).getByRole('button').getAttribute('aria-label'),
    ).toMatch(/^Edit /);
    expect(
      within(rowOf(list, 'running')).getByRole('button', { name: 'Stop Feeding' }),
    ).toBeTruthy();
    expect(within(rowOf(list, 'mine')).queryByText(/Given by/)).toBeNull();
  });
});

describe('the Day tab in pt-BR', () => {
  it('says who added and who gave, in Portuguese', async () => {
    await useTestLocale('pt-BR');
    await seed('Caregiver');
    const list = await renderDay(/^Hoje, /);
    expect(await within(rowOf(list, 'anas-dose')).findByText('Dado por Ana')).toBeTruthy();
    fireEvent.click(within(rowOf(list, 'anas-diaper')).getByRole('button'));
    const sheet = await screen.findByRole('dialog');
    expect(
      within(sheet).getByText('Registrado por Ana. Só essa pessoa ou um responsável pode alterar.'),
    ).toBeTruthy();
  });
});
