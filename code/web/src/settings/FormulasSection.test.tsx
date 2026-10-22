import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BabyRoutineDb } from '../db/database';
import type { BabyRole, Formula } from '../db/models';
import { BABY_ID, testDatabase } from '../test/fakeApi';
import { useTestLocale } from '../test/locale';
import { renderWithDb, settleSync } from '../test/renderApp';
import { seedBaby } from '../test/seed';
import { THEME_STORAGE_KEY } from '../theme/themeStorage';
import { UndoSnackbar } from '../ui/UndoSnackbar';
import { FormulasSection } from './FormulasSection';

/* Settings > Formulas: list, current badge, add, set as current, archive and restore, roles. */

let db: BabyRoutineDb;

const formula = (id: string, name: string, extra: Partial<Formula> = {}): Formula => ({
  id,
  babyId: BABY_ID,
  name,
  brand: null,
  stage: null,
  notes: null,
  startedOn: null,
  isCurrent: false,
  archived: false,
  createdBy: 'u1',
  createdAt: '2026-10-01T10:00:00.000Z',
  updatedAt: '2026-10-01T10:00:00.000Z',
  ...extra,
});

beforeEach(async () => {
  db = testDatabase();
  await seedBaby(db);
});

afterEach(async () => {
  await settleSync();
  await db.delete();
});

function renderSection(role: BabyRole = 'Owner') {
  renderWithDb(
    db,
    <>
      <FormulasSection baby={{ id: BABY_ID, name: 'Lia', birthDate: '2026-08-01', role }} />
      <UndoSnackbar />
    </>,
  );
}

const queuedFormulas = async () =>
  (await db.outbox.toArray()).filter((m) => m.entityType === 'formula').map((m) => m.payload);

describe('formulas in settings', () => {
  it('lists the formulas with the current one marked and the details', async () => {
    await db.formulas.bulkPut([
      formula('a', 'Nan 1', { brand: 'Nestlé', stage: '1', isCurrent: true }),
      formula('b', 'Aptamil 2'),
    ]);
    renderSection();

    const list = await screen.findByRole('list', { name: 'Formulas' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining('Aptamil 2'),
      expect.stringContaining('Nan 1'),
    ]);
    expect(within(rows[1]).getByText('Current')).toBeTruthy();
    expect(within(rows[1]).getByText('Nestlé · Stage 1')).toBeTruthy();
    expect(
      within(rows[1]).queryByRole('button', { name: 'Set Nan 1 as the current formula' }),
    ).toBeNull();
  });

  it('adds the first formula as the current one, with brand and stage', async () => {
    renderSection();

    fireEvent.click(await screen.findByRole('button', { name: 'Add formula' }));
    fireEvent.change(await screen.findByRole('textbox', { name: /^Name/ }), {
      target: { value: 'Nan Supreme 1' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: /^Brand/ }), {
      target: { value: 'Nestlé' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: /^Stage/ }), { target: { value: '1' } });
    expect(
      screen.getByRole('switch', { name: /Current formula/ }).getAttribute('aria-checked'),
    ).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(async () => expect(await db.formulas.count()).toBe(1));
    expect((await db.formulas.toArray())[0]).toMatchObject({
      name: 'Nan Supreme 1',
      brand: 'Nestlé',
      stage: '1',
      isCurrent: true,
    });
    expect(await queuedFormulas()).toEqual([expect.objectContaining({ name: 'Nan Supreme 1' })]);
  });

  it('asks for a name before saving', async () => {
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'Add formula' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Enter a name of up to 60 characters.')).toBeTruthy();
    expect(await db.formulas.count()).toBe(0);
  });

  it('sets another formula as current and archives one with Undo', async () => {
    await db.formulas.bulkPut([
      formula('a', 'Nan 1', { isCurrent: true }),
      formula('b', 'Aptamil 2'),
    ]);
    renderSection();

    fireEvent.click(
      await screen.findByRole('button', { name: 'Set Aptamil 2 as the current formula' }),
    );
    await waitFor(async () => expect((await db.formulas.get('b'))?.isCurrent).toBe(true));
    const list = await screen.findByRole('list', { name: 'Formulas' });
    await waitFor(() =>
      expect(within(within(list).getAllByRole('listitem')[0]).getByText('Current')).toBeTruthy(),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Archive Nan 1' }));
    expect(await screen.findByRole('list', { name: 'Archived formulas' })).toBeTruthy();
    expect(await screen.findByText('Nan 1 archived')).toBeTruthy();
    expect((await db.formulas.get('a'))?.archived).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Restore Nan 1' }));
    await waitFor(async () => expect((await db.formulas.get('a'))?.archived).toBe(false));
  });

  it.each(['Caregiver', 'Viewer'] as const)('is read-only for a %s', async (role) => {
    await db.formulas.bulkPut([formula('a', 'Nan 1', { isCurrent: true })]);
    renderSection(role);

    expect(await screen.findByText('You can see the formulas but not change them.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add formula' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit Nan 1' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Archive Nan 1' })).toBeNull();
  });
});

describe.each(['light', 'dark'] as const)('formulas in the %s scheme', (scheme) => {
  it.each(['en', 'pt-BR'] as const)(
    'has no accessibility violations in %s, also with the sheet open',
    async (locale) => {
      window.localStorage.setItem(THEME_STORAGE_KEY, scheme);
      if (locale === 'pt-BR') await useTestLocale('pt-BR');
      await db.formulas.bulkPut([
        formula('a', 'Nan 1', { isCurrent: true, stage: '1' }),
        formula('b', 'Aptamil 2', { archived: true }),
      ]);
      renderSection();
      await screen.findByRole('list', { name: locale === 'en' ? 'Formulas' : 'Fórmulas' });
      expect(await violations()).toEqual([]);

      fireEvent.click(
        screen.getByRole('button', { name: locale === 'en' ? 'Add formula' : 'Adicionar fórmula' }),
      );
      await screen.findByRole('textbox', { name: locale === 'en' ? /^Name/ : /^Nome/ });
      expect(await violations()).toEqual([]);
    },
    60_000,
  );
});

describe('pt-BR', () => {
  it('reads Fórmula atual, Marca, Estágio and Arquivar', async () => {
    await useTestLocale('pt-BR');
    await db.formulas.bulkPut([formula('a', 'Nan 1', { isCurrent: true })]);
    renderSection();

    expect(await screen.findByText('Atual')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Arquivar Nan 1' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar fórmula' }));
    expect(await screen.findByRole('textbox', { name: /^Marca/ })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: /^Estágio/ })).toBeTruthy();
    expect(screen.getByRole('switch', { name: /Fórmula atual/ })).toBeTruthy();
  });
});

async function violations() {
  const result = await axe.run(document.body, {
    runOnly: ['wcag2a', 'wcag2aa'],
    rules: { 'color-contrast': { enabled: false } },
  });
  return result.violations.map(
    (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`,
  );
}
