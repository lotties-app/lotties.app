import { useState } from 'react';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BabyRoutineDb } from '../db/database';
import type { Prescription, Proposal } from '../db/models';
import { ANA, DOCTOR_ID, proposal } from '../proposals/proposalKit';
import type { ProductDto, ProductMatchDto } from '../sync/contract';
import { BABY_ID, fakeApi, testDatabase, type ApiCall } from '../test/fakeApi';
import { renderWithDb, settleSync } from '../test/renderApp';
import { seedBaby } from '../test/seed';
import { PrescriptionSheet } from './PrescriptionSheet';
import { prescription } from './prescriptionFixtures';

/*
 * The Doctor's proposal mode of the prescription editor (docs/design/16-doctor-access.md section
 * 10.5): the same editor and validation, a medicine picker that only names the medicine, no
 * prescriber, "Send to parents" writing a pending proposal into the outbox.
 */

let db: BabyRoutineDb;

beforeEach(async () => {
  db = testDatabase();
  window.localStorage.clear();
  await seedBaby(db, { medications: true, role: 'Doctor', userId: DOCTOR_ID });
});

afterEach(async () => {
  await settleSync();
  vi.restoreAllMocks();
  await db.delete();
});

function Host(props: Partial<React.ComponentProps<typeof PrescriptionSheet>>) {
  const [open, setOpen] = useState(true);
  return open ? (
    <PrescriptionSheet
      mode="proposal"
      babyId={BABY_ID}
      authorUserId={DOCTOR_ID}
      onDone={() => setOpen(false)}
      {...props}
    />
  ) : null;
}

function renderSheet(
  props: Partial<React.ComponentProps<typeof PrescriptionSheet>> = {},
  handler: (call: ApiCall) => unknown = () => undefined,
) {
  const fake = fakeApi(handler);
  renderWithDb(db, <Host {...props} />, { api: fake.api });
  return fake;
}

const sheet = (name: string | RegExp) => screen.findByRole('dialog', { name });
const text = (label: string | RegExp) => screen.getByRole('textbox', { name: label });

async function waitForDateFields() {
  await waitFor(() => expect(screen.queryByLabelText('Loading the date field')).toBeNull());
}

const FLYGAS: ProductDto = {
  id: 'p-flygas',
  name: 'Flygas',
  form: 'drops',
  country: 'BR',
  status: 'seed',
  mergedIntoId: null,
  substances: [],
  createdAt: '2026-01-01T00:00:00.000Z',
};

const catalog = (call: ApiCall) =>
  call.path.startsWith('/api/v1/catalog/products?q=flygas')
    ? [
        {
          product: FLYGAS,
          matchedBy: 'name',
          distance: 0,
          sameActiveIngredient: [],
        } satisfies ProductMatchDto,
      ]
    : undefined;

const proposals = () => db.proposals.toArray();

describe('the Doctor prescribes', () => {
  it('is the same editor with a different title and footer, and no prescriber field', async () => {
    renderSheet();
    const dialog = await sheet('Prescribe');

    expect(within(dialog).getByText('The parents review it before anything changes.')).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Send to parents' })).toBeTruthy();
    expect(within(dialog).getByRole('note').textContent).toMatch(/not a medical device/);
    expect(within(dialog).queryByRole('textbox', { name: /Prescribed by/ })).toBeNull();
    expect(within(dialog).getByText(/Instructions for the parents/)).toBeTruthy();
    expect(within(dialog).queryByRole('button', { name: 'Save' })).toBeNull();
    expect(within(dialog).queryByRole('button', { name: 'Withdraw' })).toBeNull();
  });

  it('shows the same field errors as a prescription and saves nothing', async () => {
    renderSheet();
    await sheet('Prescribe');
    await waitForDateFields();

    fireEvent.click(screen.getByRole('button', { name: 'Send to parents' }));

    expect(await screen.findByText('Choose the medication.')).toBeTruthy();
    expect(screen.getByText('Enter a dose above zero.')).toBeTruthy();
    expect(screen.getByText('Use between 15 minutes and 7 days.')).toBeTruthy();
    expect(await proposals()).toHaveLength(0);
    expect(await db.outbox.count()).toBe(0);
  });

  it('applies the prescription rules: a per-kg dose is refused for a counted unit', async () => {
    renderSheet();
    await sheet('Prescribe');
    await waitForDateFields();
    fireEvent.click(await screen.findByRole('button', { name: 'Zeta syrup' }));
    fireEvent.change(screen.getByRole('spinbutton', { name: /Dose/ }), { target: { value: '1' } });
    fireEvent.change(text(/^Unit/), { target: { value: 'spray' } });
    fireEvent.click(screen.getByRole('switch', { name: /Dose depends on weight/ }));

    fireEvent.click(screen.getByRole('button', { name: 'Send to parents' }));

    expect(await screen.findByText(/A per-kg dose is only for measured units/)).toBeTruthy();
    expect(await proposals()).toHaveLength(0);
  });

  it("sends a medicine of the baby's list: a pending proposal in the outbox, nothing else written", async () => {
    renderSheet();
    await sheet('Prescribe');
    fireEvent.click(await screen.findByRole('button', { name: 'Zeta syrup' }));
    expect((screen.getByRole('spinbutton', { name: /Dose/ }) as HTMLInputElement).value).toBe(
      '2.5',
    );
    fireEvent.click(
      within(screen.getByRole('group', { name: 'Quick values' })).getByRole('button', {
        name: /^8/,
      }),
    );
    fireEvent.change(text(/^What it is for/), { target: { value: 'belly pain' } });
    fireEvent.click(screen.getByRole('button', { name: /^Instructions for the parents/ }));
    fireEvent.change(text(/^Instructions for the parents/), {
      target: { value: 'After the feed.' },
    });
    await waitForDateFields();

    fireEvent.click(screen.getByRole('button', { name: 'Send to parents' }));

    await waitFor(async () => expect(await proposals()).toHaveLength(1));
    const [saved] = await proposals();
    expect(saved).toMatchObject({
      babyId: BABY_ID,
      authorUserId: DOCTOR_ID,
      status: 'pending',
      medicationId: 'm-z',
      productId: null,
      medicationName: 'Zeta syrup',
      kind: 'asNeeded',
      dose: { amount: 2.5, unit: 'ml', perKg: false },
      minIntervalMinutes: 480,
      indication: 'belly pain',
      instructions: 'After the feed.',
      replacesPrescriptionId: null,
    });
    const queued = await db.outbox.toArray();
    expect(queued.map((m) => [m.entityType, m.kind, m.entityId])).toEqual([
      ['proposal', 'upsert', saved.id],
    ]);
    expect(queued[0].payload).toMatchObject({ medicationId: 'm-z', medicationName: 'Zeta syrup' });
    expect(await db.prescriptions.count()).toBe(0);
    expect(await db.medications.count()).toBe(3);
  });

  it('names a catalog product without adding a medication to the baby', async () => {
    const { calls } = renderSheet({}, catalog);
    await sheet('Prescribe');
    fireEvent.change(await screen.findByRole('searchbox', { name: 'Find or add a medication' }), {
      target: { value: 'flygas' },
    });

    const choose = await screen.findByRole('button', { name: 'Choose Flygas from the catalog' });
    expect(screen.queryByRole('button', { name: /Not listed/ })).toBeNull();
    fireEvent.click(choose);
    expect(await screen.findByText('Flygas')).toBeTruthy();
    fireEvent.change(screen.getByRole('spinbutton', { name: /Dose/ }), { target: { value: '5' } });
    fireEvent.change(text(/^Unit/), { target: { value: 'drops' } });
    fireEvent.click(
      within(screen.getByRole('group', { name: 'Quick values' })).getByRole('button', {
        name: /^8/,
      }),
    );
    await waitForDateFields();
    fireEvent.click(screen.getByRole('button', { name: 'Send to parents' }));

    await waitFor(async () => expect(await proposals()).toHaveLength(1));
    expect((await proposals())[0]).toMatchObject({
      medicationId: null,
      productId: 'p-flygas',
      medicationName: 'Flygas',
    });
    expect(await db.medications.count()).toBe(3);
    expect(calls.filter((c) => c.method !== 'GET')).toEqual([]);
    expect((await db.outbox.toArray()).map((m) => m.entityType)).toEqual(['proposal']);
  });

  it('sends a free name as only a name', async () => {
    renderSheet();
    await sheet('Prescribe');
    fireEvent.change(await screen.findByRole('searchbox', { name: 'Find or add a medication' }), {
      target: { value: 'Sorine spray' },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Use "Sorine spray"' }));
    fireEvent.change(screen.getByRole('spinbutton', { name: /Dose/ }), { target: { value: '2' } });
    fireEvent.change(text(/^Unit/), { target: { value: 'sprays' } });
    fireEvent.click(
      within(screen.getByRole('group', { name: 'Quick values' })).getByRole('button', {
        name: /^12/,
      }),
    );
    await waitForDateFields();
    fireEvent.click(screen.getByRole('button', { name: 'Send to parents' }));

    await waitFor(async () => expect(await proposals()).toHaveLength(1));
    expect((await proposals())[0]).toMatchObject({
      medicationId: null,
      productId: null,
      medicationName: 'Sorine spray',
    });
    expect(await db.medications.count()).toBe(3);
  });
});

describe('editing and changing', () => {
  it('edits a pending proposal in place and queues its new state', async () => {
    const pending = proposal('p-edit', { medicationId: 'm-z', medicationName: 'Zeta syrup' });
    await db.proposals.put(pending);
    renderSheet({ proposal: pending });
    const dialog = await sheet('Edit proposal');
    await waitForDateFields();

    expect(within(dialog).getByText(/Give 8 drops, no more often than every 6 hours/)).toBeTruthy();
    fireEvent.change(text(/^What it is for/), { target: { value: 'colic' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send to parents' }));

    await waitFor(async () => expect((await db.proposals.get('p-edit'))?.indication).toBe('colic'));
    expect(await proposals()).toHaveLength(1);
    const queued = await db.outbox.toArray();
    expect(queued.map((m) => [m.entityType, m.kind])).toEqual([['proposal', 'upsert']]);
  });

  it('withdraws a pending proposal from its editor', async () => {
    const pending = proposal('p-w');
    await db.proposals.put(pending);
    renderSheet({ proposal: pending });
    await sheet('Edit proposal');

    fireEvent.click(await screen.findByRole('button', { name: 'Withdraw' }));

    await waitFor(async () =>
      expect(await db.proposals.get('p-w')).toMatchObject({
        status: 'cancelled',
        cancelReason: 'withdrawn',
      }),
    );
    expect((await db.outbox.toArray()).map((m) => [m.entityType, m.kind])).toEqual([
      ['proposal', 'delete'],
    ]);
  });

  it('prefills a change of a prescription, starts it today and replaces it', async () => {
    const current: Prescription = prescription({
      id: 'rx-current',
      babyId: BABY_ID,
      medicationId: 'm-z',
      minIntervalMinutes: 480,
      dose: { amount: 2.5, unit: 'ml', perKg: false, roundingStep: null },
      indication: 'belly pain',
      startDate: '2026-01-01',
      endDate: '2026-01-10',
      prescribedByName: 'Ana Souza',
      prescribedBy: ANA,
      proposalId: 'p-old',
    });
    await db.prescriptions.put(current);
    renderSheet({ replaces: current });
    const dialog = await sheet('Propose a change');
    await waitForDateFields();

    expect(within(dialog).getByText(/^Changes the current prescription: Give 2.5 ml/)).toBeTruthy();
    expect(within(dialog).getByText('Zeta syrup')).toBeTruthy();
    fireEvent.change(screen.getByRole('spinbutton', { name: /Dose/ }), { target: { value: '3' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send to parents' }));

    await waitFor(async () => expect(await proposals()).toHaveLength(1));
    const [saved] = await proposals();
    const today = new Date();
    const key = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    expect(saved).toMatchObject({
      replacesPrescriptionId: 'rx-current',
      medicationId: 'm-z',
      dose: { amount: 3, unit: 'ml' },
      startDate: key,
      // The old course ended before today: the change has no end date.
      endDate: null,
    });
    // The prescription itself is untouched: only the parents change it.
    expect(await db.prescriptions.get('rx-current')).toEqual(current);
  });

  it('prefills a change from the accepted proposal when its prescription is not here', async () => {
    const accepted: Proposal = proposal('p-acc', {
      status: 'accepted',
      acceptedPrescriptionId: 'rx-elsewhere',
      medicationName: 'Colidis',
    });
    renderSheet({ replacesProposal: accepted });
    const dialog = await sheet('Propose a change');
    await waitForDateFields();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Send to parents' }));

    await waitFor(async () => expect(await proposals()).toHaveLength(1));
    expect((await proposals())[0]).toMatchObject({
      replacesPrescriptionId: 'rx-elsewhere',
      medicationName: 'Colidis',
      dose: { amount: 8, unit: 'drops' },
    });
  });

  it('asks before discarding what was typed', async () => {
    renderSheet();
    await sheet('Prescribe');
    fireEvent.click(await screen.findByRole('button', { name: 'Zeta syrup' }));

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    expect(await screen.findByText('Discard your changes?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await proposals()).toHaveLength(0);
  });
});
