import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BabyRoutineDb } from '../db/database';
import { deleteMedication } from '../db/medicationCommands';
import {
  createPrescription,
  deletePrescription,
  setPrescriptionStatus,
  termsOf,
  updatePrescription,
} from '../db/prescriptionCommands';
import { cacheProducts } from '../db/catalogCache';
import { asNeeded, atTimes } from '../medications/prescriptionFixtures';
import type { ProductDto } from '../sync/contract';
import { BABY_ID, fakeApi, testDatabase } from '../test/fakeApi';
import { useTestLocale } from '../test/locale';
import { renderWithDb, settleSync } from '../test/renderApp';
import { seedBaby } from '../test/seed';
import { UndoSnackbar } from '../ui/UndoSnackbar';
import { MedicationsSection } from './MedicationsSection';

let db: BabyRoutineDb;
const BABY = { id: BABY_ID, name: 'Lia', birthDate: '2026-08-01', role: 'Owner' as const };

beforeEach(async () => {
  db = testDatabase();
  await seedBaby(db, { medications: true });
});

afterEach(async () => {
  await settleSync();
  vi.restoreAllMocks();
  await db.delete();
});

const PRODUCT: ProductDto = {
  id: 'p-1',
  name: 'Alpha tablet',
  form: 'tablet',
  country: 'BR',
  status: 'seed',
  mergedIntoId: null,
  substances: [
    {
      substanceId: 's1',
      key: 'simethicone',
      nameEn: 'Simethicone',
      namePtBr: 'Simeticona',
      strength: null,
    },
  ],
  createdAt: '2026-01-01T00:00:00.000Z',
};

function renderSection(role: 'Owner' | 'Viewer' = 'Owner') {
  renderWithDb(
    db,
    <>
      <MedicationsSection baby={{ ...BABY, role }} />
      <UndoSnackbar />
    </>,
    { api: fakeApi().api },
  );
}

describe('MedicationsSection', () => {
  it('lists medications with their linked product and prescriptions with the next-allowed state', async () => {
    await cacheProducts(db, [PRODUCT]);
    await db.medications.update('m-a', { productId: 'p-1' });
    const dose = await db.prescriptions.put({
      ...asNeeded('m-a', 480),
      id: 'rx-1',
      babyId: BABY_ID,
      indication: 'belly pain',
    });
    expect(dose).toBe('rx-1');
    await db.prescriptions.put({
      ...asNeeded('m-z', 360),
      id: 'rx-2',
      babyId: BABY_ID,
      status: 'stopped',
    });
    await db.prescriptions.put({
      ...atTimes('m-b', ['08:00']),
      id: 'rx-3',
      babyId: BABY_ID,
      endDate: '2026-02-01',
    });
    renderSection();

    const meds = await screen.findByRole('list', { name: 'Medications' });
    expect(await within(meds).findByText('Tablet · Simethicone')).toBeTruthy();

    const active = await screen.findByRole('list', { name: 'Prescriptions' });
    const rows = within(active).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toMatch(/Alpha tablet/);
    expect(rows[0].textContent).toMatch(/Give 2 drops, no more often than every 8 hours/);
    expect(rows[0].textContent).toMatch(/Available now/);
    expect(rows[1].textContent).toMatch(/Beta drops/);
    expect(rows[1].textContent).toMatch(/Course ended/);

    const stopped = screen.getByRole('list', { name: 'Stopped prescriptions' });
    expect(stopped.textContent).toMatch(/Zeta syrup/);
    expect(screen.getByRole('note').textContent).toMatch(/not a medical device/);
  });

  it('toggles a medication as usual through the local store', async () => {
    renderSection();
    const toggle = await screen.findByRole('switch', { name: 'Usual: Beta drops' });
    expect((toggle as HTMLInputElement).checked).toBe(false);
    fireEvent.click(toggle);
    await waitFor(async () => expect((await db.medications.get('m-b'))?.isUsual).toBe(true));
    expect((await db.outbox.toArray()).map((m) => [m.kind, m.entityType])).toEqual([
      ['upsert', 'medication'],
    ]);
  });

  it('deletes a medication with Undo, which restores it and its prescriptions', async () => {
    await db.prescriptions.put({ ...asNeeded('m-a', 480), id: 'rx-1', babyId: BABY_ID });
    renderSection();

    fireEvent.click(await screen.findByRole('button', { name: 'Delete Alpha tablet' }));
    await waitFor(async () => expect(await db.medications.get('m-a')).toBeUndefined());
    expect((await db.prescriptions.get('rx-1'))?.deletedAt).not.toBeNull();

    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }));
    await waitFor(async () => {
      const restored = (await db.medications.toArray()).find((m) => m.name === 'Alpha tablet');
      expect(restored).toBeTruthy();
      const live = (await db.prescriptions.toArray()).filter((p) => p.deletedAt === null);
      expect(live.map((p) => p.medicationId)).toEqual([restored!.id]);
      expect(live[0].minIntervalMinutes).toBe(480);
    });
  });

  it('opens the editor of a prescription and the dialog of a medication', async () => {
    await db.prescriptions.put({ ...asNeeded('m-a', 480), id: 'rx-1', babyId: BABY_ID });
    renderSection();

    fireEvent.click(
      await screen.findByRole('button', { name: 'Edit prescription for Alpha tablet' }),
    );
    expect(await screen.findByRole('dialog', { name: 'Edit prescription' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    fireEvent.click(await screen.findByRole('button', { name: 'Add prescription' }));
    expect(await screen.findByRole('dialog', { name: 'Add prescription' })).toBeTruthy();
  });

  it('is read-only for viewers', async () => {
    await db.prescriptions.put({ ...asNeeded('m-a', 480), id: 'rx-1', babyId: BABY_ID });
    renderSection('Viewer');
    await screen.findByRole('list', { name: 'Prescriptions' });
    expect(screen.queryByRole('button', { name: 'Add prescription' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Edit prescription for/ })).toBeNull();
    expect(screen.queryByRole('switch')).toBeNull();
  });

  it('reads in Portuguese', async () => {
    await useTestLocale('pt-BR');
    await db.prescriptions.put({ ...asNeeded('m-a', 480), id: 'rx-1', babyId: BABY_ID });
    renderSection();
    const list = await screen.findByRole('list', { name: 'Receitas' });
    expect(list.textContent).toMatch(/Dar 2 gotas, com intervalo mínimo de 8 horas/);
    expect(list.textContent).toMatch(/Disponível agora/);
    expect(screen.getByRole('button', { name: 'Adicionar receita' })).toBeTruthy();
  });
});

describe('MedicationDialog with the shared catalog', () => {
  it('links a found product, saves its id and can unlink', async () => {
    const api = fakeApi((call) =>
      call.path.includes('/catalog/products')
        ? [{ product: PRODUCT, matchedBy: 'name', distance: 0, sameActiveIngredient: [] }]
        : undefined,
    );
    renderWithDb(db, <MedicationsSection baby={BABY} />, { api: api.api });

    fireEvent.click(await screen.findByRole('button', { name: 'Add medication' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByRole('textbox', { name: /^Name/ }), {
      target: { value: 'alpha tab' },
    });
    fireEvent.click(
      await within(dialog).findByRole('button', { name: 'Add Alpha tablet from the catalog' }),
    );

    expect(await within(dialog).findByText(/Linked to Alpha tablet/)).toBeTruthy();
    expect((within(dialog).getByRole('textbox', { name: /^Name/ }) as HTMLInputElement).value).toBe(
      'Alpha tablet',
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(async () => {
      const [created] = (await db.medications.toArray()).filter(
        (m) => m.name === 'Alpha tablet' && m.id !== 'm-a',
      );
      expect(created?.productId).toBe('p-1');
    });
  });
});

describe('prescription commands', () => {
  it('create, edit, stop, resume and delete write locally and queue the upserts and the delete', async () => {
    const rx = await createPrescription(db, BABY_ID, termsOf(asNeeded('m-a', 480)));
    await updatePrescription(db, rx.id, { ...termsOf(rx), minIntervalMinutes: 360 });
    await setPrescriptionStatus(db, rx.id, 'stopped');
    await setPrescriptionStatus(db, rx.id, 'active');
    expect(await deletePrescription(db, rx.id)).toMatchObject({ minIntervalMinutes: 360 });
    expect(await deletePrescription(db, rx.id)).toBeUndefined();

    const queue = await db.outbox.orderBy('id').toArray();
    expect(queue.map((m) => [m.kind, m.entityType])).toEqual([
      ['upsert', 'prescription'],
      ['upsert', 'prescription'],
      ['upsert', 'prescription'],
      ['upsert', 'prescription'],
      ['delete', 'prescription'],
    ]);
    expect(queue[2].payload).toMatchObject({ status: 'stopped', minIntervalMinutes: 360 });
    await expect(updatePrescription(db, rx.id, termsOf(rx))).rejects.toThrow(/no longer exists/);
  });

  it('deleting a medication soft deletes its prescriptions locally and returns them for Undo', async () => {
    await db.prescriptions.put({ ...asNeeded('m-a', 480), id: 'rx-1', babyId: BABY_ID });
    const deleted = await deleteMedication(db, 'm-a');
    expect(deleted?.medication.name).toBe('Alpha tablet');
    expect(deleted?.prescriptions).toHaveLength(1);
    expect((await db.prescriptions.get('rx-1'))?.deletedAt).not.toBeNull();
    expect(await deleteMedication(db, 'm-a')).toBeUndefined();
  });
});
