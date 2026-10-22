import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BabyRoutineDb } from '../db/database';
import { createEvent } from '../db/eventCommands';
import type { BabyRole, Formula } from '../db/models';
import { FEEDING_TYPE, SLEEP_TYPE } from '../test/builtInTypes';
import { BABY_ID, testDatabase } from '../test/fakeApi';
import { useTestLocale } from '../test/locale';
import { renderWithDb } from '../test/renderApp';
import { seedBaby } from '../test/seed';
import { EventSheet } from './EventSheet';

/*
 * The formula of a bottle in the event sheet (docs/design/14-formulas.md): the baby's formulas as
 * chips (current preselected), "+ New formula" with name suggestions for Owners and Parents, the
 * name snapshot saved with the bottle.
 */

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

async function setup(role: BabyRole = 'Owner', formulas: Formula[] = []) {
  await seedBaby(db, { role });
  await db.formulas.bulkPut(formulas);
}

beforeEach(() => {
  db = testDatabase();
});

afterEach(async () => {
  await db.delete();
});

function renderBottle(content = 'formula') {
  const now = new Date().toISOString();
  renderWithDb(
    db,
    <EventSheet
      babyId={BABY_ID}
      types={[FEEDING_TYPE, SLEEP_TYPE]}
      prefill={{
        typeId: FEEDING_TYPE.id,
        startedAt: now,
        endedAt: now,
        payload: { method: 'bottle', amount_ml: 120, bottle_feeding_type: content },
      }}
      onDone={() => {}}
    />,
  );
}

const formulaGroup = async () => screen.findByRole('radiogroup', { name: /^Formula/ });
const save = () => fireEvent.click(screen.getAllByRole('button', { name: 'Save' }).at(-1)!);

async function savedPayload() {
  await waitFor(async () => expect(await db.events.count()).toBe(1));
  return (await db.events.toArray())[0].payload;
}

describe('formula chips of a bottle', () => {
  it('preselects the current formula and saves its id with a name snapshot', async () => {
    await setup('Owner', [
      formula('f-nan', 'Nan 1'),
      formula('f-apt', 'Aptamil 2', { isCurrent: true }),
    ]);
    renderBottle();

    const group = await formulaGroup();
    expect(
      within(group).getByRole('radio', { name: 'Aptamil 2' }).getAttribute('aria-checked'),
    ).toBe('true');
    save();

    expect(await savedPayload()).toMatchObject({ formula_id: 'f-apt', formula_name: 'Aptamil 2' });
  });

  it('saves another chip once picked, and none after tapping the selected chip again', async () => {
    await setup('Owner', [
      formula('f-nan', 'Nan 1'),
      formula('f-apt', 'Aptamil 2', { isCurrent: true }),
    ]);
    renderBottle();
    const group = await formulaGroup();

    fireEvent.click(within(group).getByRole('radio', { name: 'Nan 1' }));
    fireEvent.click(within(group).getByRole('radio', { name: 'Nan 1' }));
    save();

    const payload = await savedPayload();
    expect(payload).not.toHaveProperty('formula_id');
    expect(payload).not.toHaveProperty('formula_name');
  });

  it('falls back to the last formula used when none is current', async () => {
    await setup('Owner', [formula('f-nan', 'Nan 1'), formula('f-apt', 'Aptamil 2')]);
    const at = new Date(Date.now() - 3 * 3_600_000).toISOString();
    await createEvent(db, {
      babyId: BABY_ID,
      typeId: FEEDING_TYPE.id,
      startedAt: at,
      endedAt: at,
      payload: { method: 'bottle', bottle_feeding_type: 'formula', formula_id: 'f-nan' },
    });
    renderBottle();

    const group = await formulaGroup();
    await waitFor(() =>
      expect(within(group).getByRole('radio', { name: 'Nan 1' }).getAttribute('aria-checked')).toBe(
        'true',
      ),
    );
  });

  it('adds a new formula inline with a name suggestion and selects it', async () => {
    await setup('Owner');
    renderBottle();

    fireEvent.click(await screen.findByRole('button', { name: 'New formula' }));
    const name = await screen.findByRole('textbox', { name: /^Name/ });
    fireEvent.change(name, { target: { value: 'apt' } });
    fireEvent.click(screen.getByRole('button', { name: 'Use Aptamil 2' }));
    expect((name as HTMLInputElement).value).toBe('Aptamil 2');
    fireEvent.click(within(name.closest('form')!).getByRole('button', { name: 'Save' }));

    const group = await formulaGroup();
    await waitFor(() =>
      expect(
        within(group).getByRole('radio', { name: 'Aptamil 2' }).getAttribute('aria-checked'),
      ).toBe('true'),
    );
    const [created] = await db.formulas.toArray();
    expect(created).toMatchObject({ name: 'Aptamil 2', isCurrent: true, archived: false });
    save();
    expect(await savedPayload()).toMatchObject({
      formula_id: created.id,
      formula_name: 'Aptamil 2',
    });
  });

  it('lets a Caregiver pick a formula but not add one', async () => {
    await setup('Caregiver', [formula('f-nan', 'Nan 1', { isCurrent: true })]);
    renderBottle();

    expect(await formulaGroup()).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'New formula' })).toBeNull();
  });

  it('shows no formula for breast milk, and nothing for a Caregiver without formulas', async () => {
    await setup('Caregiver');
    renderBottle();
    await screen.findByRole('dialog');
    expect(screen.queryByRole('radiogroup', { name: /^Formula/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'New formula' })).toBeNull();
  });

  it('never fills a formula in when editing an older bottle that names none', async () => {
    await setup('Owner', [formula('f-nan', 'Nan 1', { isCurrent: true })]);
    const at = new Date(Date.now() - 3_600_000).toISOString();
    const event = await createEvent(db, {
      babyId: BABY_ID,
      typeId: FEEDING_TYPE.id,
      startedAt: at,
      endedAt: at,
      payload: { method: 'bottle', amount_ml: 90, bottle_feeding_type: 'formula' },
    });
    renderWithDb(
      db,
      <EventSheet babyId={BABY_ID} types={[FEEDING_TYPE]} event={event} onDone={() => {}} />,
    );

    const group = await formulaGroup();
    expect(within(group).getByRole('radio', { name: 'Nan 1' }).getAttribute('aria-checked')).toBe(
      'false',
    );
  });

  it('has no axe violation with the chips', async () => {
    await setup('Owner', [formula('f-nan', 'Nan 1', { isCurrent: true })]);
    renderBottle();
    await formulaGroup();
    const results = await axe.run(screen.getByRole('dialog'));
    expect(results.violations).toEqual([]);
  });
});

describe('formula chips in pt-BR', () => {
  it('reads Fórmula and Nova fórmula', async () => {
    await useTestLocale('pt-BR');
    await setup('Owner', [formula('f-nan', 'Nan 1', { isCurrent: true })]);
    renderBottle();
    expect(await screen.findByRole('radiogroup', { name: /^Fórmula/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Nova fórmula' })).toBeTruthy();
  });
});
