import { useState } from 'react';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BabyRoutineDb } from '../../db/database';
import { BABY_ID, testDatabase } from '../../test/fakeApi';
import { useTestLocale } from '../../test/locale';
import { renderWithDb, settleSync } from '../../test/renderApp';
import { Field } from './Field';
import { MedicationPicker, type MedicationSelection } from './MedicationPicker';

let db: BabyRoutineDb;

const medication = (
  id: string,
  name: string,
  isUsual: boolean,
  defaultDosage: { amount: number; unit: string } | null = null,
) => ({
  id,
  babyId: BABY_ID,
  name,
  isUsual,
  defaultDosage,
  notes: null,
  createdAt: '2026-10-01T00:00:00.000Z',
});

beforeEach(async () => {
  db = testDatabase();
  await db.medications.bulkPut([
    medication('m1', 'Paracetamol', false, { amount: 2.5, unit: 'ml' }),
    medication('m2', 'Vitamin D', true),
    medication('m3', 'Colidis', true, { amount: 5, unit: 'drops' }),
  ]);
});

afterEach(async () => {
  await settleSync();
  await db.delete();
});

function Picker({ initial = {} as MedicationSelection }) {
  const [selected, setSelected] = useState(initial);
  return (
    <Field label="Medications" group>
      <MedicationPicker babyId={BABY_ID} selected={selected} onChange={setSelected} />
      <span data-testid="selected">{JSON.stringify(selected)}</span>
    </Field>
  );
}
const selection = () =>
  JSON.parse(screen.getByTestId('selected').textContent!) as MedicationSelection;

describe('MedicationPicker', () => {
  it('lists the usual medications first, then the others by name', async () => {
    renderWithDb(db, <Picker />);
    const boxes = await screen.findAllByRole('checkbox');
    expect(boxes.map((box) => box.textContent)).toEqual([
      'Colidis' + 'Usual',
      'Vitamin D' + 'Usual',
      'Paracetamol',
    ]);
    expect(boxes.every((box) => box.getAttribute('aria-checked') === 'false')).toBe(true);
  });

  it('checks a medication with its usual dose and shows the dose stepper inline', async () => {
    renderWithDb(db, <Picker />);
    fireEvent.click(await screen.findByRole('checkbox', { name: /^Paracetamol/ }));
    expect(selection()).toEqual({ m1: { name: 'Paracetamol', amount: '2.5', unit: 'ml' } });
    const dose = screen.getByRole('spinbutton', { name: 'Paracetamol dose' });
    expect(dose.getAttribute('aria-valuenow')).toBe('2.5');
    // ml steps by half a unit.
    fireEvent.click(screen.getByRole('button', { name: 'Increase' }));
    expect(selection().m1!.amount).toBe('3');
    // The unit is a choice, and switching it changes the step (mg: 5).
    fireEvent.click(screen.getByRole('radio', { name: 'mg' }));
    expect(selection().m1!.unit).toBe('mg');
    fireEvent.click(screen.getByRole('button', { name: 'Increase' }));
    expect(selection().m1!.amount).toBe('8');
    fireEvent.click(screen.getByRole('checkbox', { name: /^Paracetamol/ }));
    expect(selection()).toEqual({});
  });

  it('keeps a stored unit that is not one of the standard choices', async () => {
    renderWithDb(
      db,
      <Picker initial={{ m1: { name: 'Paracetamol', amount: '1', unit: 'colheres' } }} />,
    );
    expect(await screen.findByRole('radio', { name: 'colheres' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'colheres' }).getAttribute('aria-checked')).toBe(
      'true',
    );
  });

  it('filters by name ignoring case and accents, but keeps checked ones visible', async () => {
    renderWithDb(db, <Picker />);
    fireEvent.click(await screen.findByRole('checkbox', { name: /^Colidis/ }));
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'PARACÉT' } });
    expect(screen.getAllByRole('checkbox').map((b) => b.textContent)).toEqual([
      'Colidis' + 'Usual',
      'Paracetamol',
    ]);
  });

  it('offers Add "name" for a name that does not exist and creates a checked catalog entry', async () => {
    renderWithDb(db, <Picker />);
    await screen.findAllByRole('checkbox');
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Ibuprofen' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add "Ibuprofen"' }));

    await waitFor(() => expect(Object.keys(selection())).toHaveLength(1));
    const [id] = Object.keys(selection());
    expect(selection()[id!]).toEqual({ name: 'Ibuprofen', amount: '', unit: '' });
    const saved = await db.medications.get(id!);
    expect(saved).toMatchObject({ name: 'Ibuprofen', babyId: BABY_ID });
    // Through the existing command: an upsert is queued for the server.
    expect(await db.outbox.where('entityId').equals(id!).count()).toBe(1);
    expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('');
    expect(screen.getByRole('checkbox', { name: /^Ibuprofen/ }).getAttribute('aria-checked')).toBe(
      'true',
    );
  });

  it('does not offer to add a name that already exists', async () => {
    renderWithDb(db, <Picker />);
    await screen.findAllByRole('checkbox');
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: ' colidis ' } });
    expect(screen.queryByRole('button', { name: /^Add "/ })).toBeNull();
  });

  it('says there are no medications yet when the catalog is empty', async () => {
    await db.medications.clear();
    renderWithDb(db, <Picker />);
    expect(await screen.findByText('No medications yet. Type a name to add one.')).toBeTruthy();
  });

  it('speaks Portuguese', async () => {
    await useTestLocale('pt-BR');
    renderWithDb(db, <Picker />);
    const first = (await screen.findAllByRole('checkbox'))[0]!;
    expect(within(first).getByText('De uso comum')).toBeTruthy();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Dipirona' } });
    expect(screen.getByRole('button', { name: 'Adicionar "Dipirona"' })).toBeTruthy();
  });
});
