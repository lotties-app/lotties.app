import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BabyRoutineDb } from '../db/database';
import type { BabyRole } from '../db/models';
import { createProposal } from '../db/proposalCommands';
import { prescription } from '../medications/prescriptionFixtures';
import { BABY_ID, fakeApi, testDatabase } from '../test/fakeApi';
import { useTestLocale } from '../test/locale';
import { renderWithDb, settleSync } from '../test/renderApp';
import { THEME_STORAGE_KEY } from '../theme/themeStorage';
import { DOCTOR_ID, proposal, seedFamily } from './proposalKit';
import { ProposalsScreen } from './ProposalsScreen';

/*
 * "My proposals" (docs/design/16-doctor-access.md section 10.5): the Doctor's own proposals, newest
 * first, each with its status; edit and withdraw only while pending; "Propose a change" on an
 * accepted one.
 */

let db: BabyRoutineDb;

beforeEach(() => {
  db = testDatabase();
  window.localStorage.clear();
});

afterEach(async () => {
  await settleSync();
  await db.delete();
});

async function renderScreen(role: BabyRole = 'Doctor') {
  const baby = await seedFamily(db, role);
  return renderWithDb(db, <ProposalsScreen baby={baby} />, { api: fakeApi().api });
}

const rows = () => screen.findAllByRole('listitem');

const SIX = [
  proposal('p-new', { medicationName: 'Colidis', createdAt: '2026-10-22T09:00:00.000Z' }),
  proposal('p-acc', {
    medicationName: 'Vitamin D',
    status: 'accepted',
    acceptedPrescriptionId: 'rx-vitd',
    createdAt: '2026-10-21T09:00:00.000Z',
  }),
  proposal('p-dec', {
    medicationName: 'Simethicone',
    status: 'declined',
    declineReason: 'We will wait for the next visit.',
    createdAt: '2026-10-20T09:00:00.000Z',
  }),
  proposal('p-gone', {
    medicationName: 'Ibuprofen',
    status: 'cancelled',
    cancelReason: 'access_removed',
    createdAt: '2026-10-19T09:00:00.000Z',
  }),
  proposal('p-wd', {
    medicationName: 'Paracetamol',
    status: 'cancelled',
    cancelReason: 'withdrawn',
    createdAt: '2026-10-18T09:00:00.000Z',
  }),
  proposal('p-sup', {
    medicationName: 'Zinc',
    status: 'superseded',
    createdAt: '2026-10-17T09:00:00.000Z',
  }),
];

describe('the list', () => {
  it('shows her proposals newest first, each with its status chip', async () => {
    await db.proposals.bulkPut([...SIX].reverse());
    await renderScreen();

    const items = await rows();
    expect(items.map((item) => item.getAttribute('aria-label'))).toEqual([
      'Colidis',
      'Vitamin D',
      'Simethicone',
      'Ibuprofen',
      'Paracetamol',
      'Zinc',
    ]);
    const chips = items.map(
      (item) =>
        within(item).getByText(/^(Pending|Accepted|Declined|Cancelled|Replaced)$/).textContent,
    );
    expect(chips).toEqual([
      'Pending',
      'Accepted',
      'Declined',
      'Cancelled',
      'Cancelled',
      'Replaced',
    ]);
    expect(
      within(items[0]).getByText(/^Give 8 drops, no more often than every 6 hours/),
    ).toBeTruthy();
    expect(within(items[0]).getByText('Sent Oct 22, 2026')).toBeTruthy();
  });

  it('shows the decline reason and "Access removed", and nothing for the other states', async () => {
    await db.proposals.bulkPut(SIX);
    await renderScreen();

    const items = await rows();
    expect(within(items[2]).getByText('Reason: We will wait for the next visit.')).toBeTruthy();
    expect(within(items[3]).getByText('Access removed')).toBeTruthy();
    expect(within(items[4]).queryByText('Access removed')).toBeNull();
    expect(within(items[0]).queryByText(/^Reason:/)).toBeNull();
  });

  it('offers edit and withdraw only on a pending proposal, and "Propose a change" only on an accepted one', async () => {
    await db.proposals.bulkPut(SIX);
    await renderScreen();

    const items = await rows();
    const buttons = items.map((item) =>
      within(item)
        .queryAllByRole('button')
        .map((button) => button.textContent),
    );
    expect(buttons).toEqual([['Edit', 'Withdraw'], ['Propose a change'], [], [], [], []]);
  });

  it('says it is empty and keeps the Prescribe button', async () => {
    await renderScreen();

    expect(await screen.findByText('No proposals yet')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Prescribe' })).toBeTruthy();
  });

  it('marks a proposal that was written offline as waiting to sync', async () => {
    await seedFamily(db, 'Doctor');
    await createProposal(db, BABY_ID, DOCTOR_ID, {
      medicationId: null,
      productId: null,
      medicationName: 'Colidis',
      kind: 'asNeeded',
      dose: { amount: 5, unit: 'drops', perKg: false, roundingStep: null },
      timesOfDay: null,
      everyMinutes: null,
      dayParts: null,
      dayPartReminders: null,
      minIntervalMinutes: 480,
      maxDosesPer24h: null,
      indication: null,
      intervalGroup: null,
      startDate: '2026-10-22',
      endDate: null,
      instructions: null,
      replacesPrescriptionId: null,
    });
    await renderScreen();

    const [item] = await rows();
    expect(within(item).getByText('Waiting to sync')).toBeTruthy();
  });
});

describe('what she can do', () => {
  it('writes a new proposal from Prescribe', async () => {
    await renderScreen();

    fireEvent.click(await screen.findByRole('button', { name: 'Prescribe' }));

    expect(await screen.findByRole('dialog', { name: 'Prescribe' })).toBeTruthy();
  });

  it('opens a pending proposal in the editor', async () => {
    await db.proposals.put(SIX[0]);
    await renderScreen();

    fireEvent.click(await screen.findByRole('button', { name: 'Edit proposal for Colidis' }));

    expect(await screen.findByRole('dialog', { name: 'Edit proposal' })).toBeTruthy();
  });

  it('withdraws a pending proposal after asking, keeping it in the list as cancelled', async () => {
    await db.proposals.put(SIX[0]);
    await renderScreen();

    fireEvent.click(await screen.findByRole('button', { name: 'Withdraw proposal for Colidis' }));
    expect(await screen.findByText('Withdraw this proposal?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw proposal' }));

    await waitFor(async () =>
      expect(await db.proposals.get('p-new')).toMatchObject({
        status: 'cancelled',
        cancelReason: 'withdrawn',
      }),
    );
    expect((await db.outbox.toArray()).map((m) => [m.entityType, m.kind])).toEqual([
      ['proposal', 'delete'],
    ]);
    const [item] = await rows();
    expect(within(item).getByText('Cancelled')).toBeTruthy();
    expect(within(item).queryByRole('button')).toBeNull();
  });

  it('proposes a change to the prescription an accepted proposal created, prefilled from it', async () => {
    await db.proposals.put(SIX[1]);
    await db.prescriptions.put(
      prescription({
        id: 'rx-vitd',
        babyId: BABY_ID,
        medicationId: 'm-z',
        dose: { amount: 2, unit: 'drops', perKg: false, roundingStep: null },
        minIntervalMinutes: 720,
        prescribedByName: 'Ana Souza',
        proposalId: 'p-acc',
      }),
    );
    await renderScreen();

    fireEvent.click(await screen.findByRole('button', { name: 'Propose a change to Vitamin D' }));

    const dialog = await screen.findByRole('dialog', { name: 'Propose a change' });
    expect(
      within(dialog).getByText(/^Changes the current prescription: Give 2 drops/),
    ).toBeTruthy();
    expect(within(dialog).getByText('Zeta syrup')).toBeTruthy();
    await waitFor(() => expect(screen.queryByLabelText('Loading the date field')).toBeNull());
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send to parents' }));

    await waitFor(async () => expect(await db.proposals.count()).toBe(2));
    const created = (await db.proposals.toArray()).find((p) => p.id !== 'p-acc')!;
    expect(created).toMatchObject({
      replacesPrescriptionId: 'rx-vitd',
      status: 'pending',
      medicationId: 'm-z',
    });
  });

  it('falls back to the proposal when its prescription is not on the device, and offers nothing for a deleted one', async () => {
    await db.proposals.put(SIX[1]);
    await renderScreen();
    expect(
      await screen.findByRole('button', { name: 'Propose a change to Vitamin D' }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Propose a change to Vitamin D' }));
    expect(await screen.findByRole('dialog', { name: 'Propose a change' })).toBeTruthy();
  });

  it('hides "Propose a change" when the prescription was deleted', async () => {
    await db.proposals.put(SIX[1]);
    await db.prescriptions.put(
      prescription({
        id: 'rx-vitd',
        babyId: BABY_ID,
        medicationId: 'm-z',
        deletedAt: '2026-10-22T10:00:00.000Z',
      }),
    );
    await renderScreen();

    const [item] = await rows();
    expect(within(item).queryByRole('button')).toBeNull();
  });

  it.each<BabyRole>(['Owner', 'Parent', 'Caregiver', 'Viewer'])(
    'is for the Doctor only: a %s gets no Prescribe button and no list',
    async (role) => {
      await db.proposals.put(SIX[0]);
      await renderScreen(role);

      expect(await screen.findByText("Proposals are sent by the baby's doctor.")).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Prescribe' })).toBeNull();
      expect(screen.queryByText('Colidis')).toBeNull();
    },
  );
});

describe('pt-BR', () => {
  it('reads Pendente, Aceita, Recusada, Cancelada and Substituída with the reason', async () => {
    await useTestLocale('pt-BR');
    await db.proposals.bulkPut(SIX);
    await renderScreen();

    const items = await rows();
    const chips = items.map(
      (item) =>
        within(item).getByText(/^(Pendente|Aceita|Recusada|Cancelada|Substituída)$/).textContent,
    );
    expect(chips).toEqual([
      'Pendente',
      'Aceita',
      'Recusada',
      'Cancelada',
      'Cancelada',
      'Substituída',
    ]);
    expect(within(items[2]).getByText('Motivo: We will wait for the next visit.')).toBeTruthy();
    expect(within(items[3]).getByText('Acesso removido')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Prescrever' })).toBeTruthy();
    expect(within(items[1]).getByRole('button', { name: /^Propor uma mudança/ })).toBeTruthy();
  });
});

describe.each(['light', 'dark'] as const)('My proposals in the %s scheme', (scheme) => {
  it.each(['en', 'pt-BR'] as const)(
    'has no accessibility violations in %s, also with the editor open',
    async (locale) => {
      window.localStorage.setItem(THEME_STORAGE_KEY, scheme);
      if (locale === 'pt-BR') await useTestLocale('pt-BR');
      await db.proposals.bulkPut(SIX);
      await renderScreen();
      await rows();
      expect(await violations()).toEqual([]);

      fireEvent.click(
        screen.getByRole('button', { name: locale === 'en' ? 'Prescribe' : 'Prescrever' }),
      );
      await screen.findByRole('dialog');
      await waitFor(() => expect(screen.queryByLabelText('Loading the date field')).toBeNull());
      expect(await violations()).toEqual([]);
    },
    60_000,
  );
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
