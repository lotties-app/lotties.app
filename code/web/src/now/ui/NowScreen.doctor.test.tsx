import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BabyRoutineDb } from '../../db/database';
import type { Baby, BabyRole, Prescription } from '../../db/models';
import { asNeeded } from '../../medications/prescriptionFixtures';
import {
  ANA,
  DOCTOR_ID,
  VERIFIED_ANA,
  proposal,
  recommendation,
} from '../../proposals/proposalKit';
import { fakeApi, testDatabase } from '../../test/fakeApi';
import { useTestLocale } from '../../test/locale';
import { renderWithDb, settleSync } from '../../test/renderApp';
import { THEME_STORAGE_KEY } from '../../theme/themeStorage';
import { BABY, nowApi, seedMorning, seedNow } from './nowKit';
import { NowScreen } from './NowScreen';

/*
 * Now with the doctor's suggestions (docs/design/16-doctor-access.md section 10): the inbox below
 * the state card for the Owners and Parents, the provenance of doctor-prescribed prescriptions in the
 * Meds tray for everyone, and "Propose a change" there for the Doctor only.
 */

let db: BabyRoutineDb;

beforeEach(() => {
  db = testDatabase();
  window.localStorage.clear();
});

afterEach(async () => {
  await settleSync();
  vi.useRealTimers();
  vi.restoreAllMocks();
  await db.delete();
});

const babyFor = (role: BabyRole): Baby => ({
  ...BABY,
  role,
  userId: role === 'Doctor' ? DOCTOR_ID : 'u-me',
});

async function renderNow(role: BabyRole = 'Owner') {
  const baby = babyFor(role);
  await seedNow(db, { role });
  await db.babies.put(baby);
  await seedMorning(db, 112);
  const { api } = fakeApi(nowApi());
  return renderWithDb(db, <NowScreen baby={baby} />, { api });
}

/** Colidis prescribed by the doctor and changed by the parents; Paracetamol the parents' own. */
async function seedPrescriptions(): Promise<{ colidis: Prescription; paracetamol: Prescription }> {
  const original = {
    medicationName: 'Colidis',
    productId: null,
    kind: 'asNeeded' as const,
    dose: { amount: 5, unit: 'drops', perKg: false, roundingStep: null },
    timesOfDay: null,
    everyMinutes: null,
    dayParts: null,
    dayPartReminders: null,
    minIntervalMinutes: 720,
    maxDosesPer24h: null,
    indication: 'belly pain',
    intervalGroup: null,
    startDate: '2026-10-01',
    endDate: null,
    instructions: 'Only after a feed.',
  };
  const colidis = asNeeded('m-colidis', 480, {
    dose: { amount: 6, unit: 'drops', perKg: false, roundingStep: null },
  });
  Object.assign(colidis, {
    prescribedByUserId: DOCTOR_ID,
    prescribedByName: 'Ana Souza',
    prescribedBy: ANA,
    proposalId: 'p-old',
    changedByParent: true,
    original,
  });
  const paracetamol = asNeeded('m-paracetamol', 360);
  await db.prescriptions.bulkPut([colidis, paracetamol]);
  return { colidis, paracetamol };
}

const tile = (name: RegExp) => screen.findByRole('button', { name });
const cardOf = (tray: HTMLElement, name: string) =>
  within(tray)
    .getAllByRole('listitem')
    .find((item) => item.textContent?.includes(name))!;
const openTray = async () => {
  fireEvent.click(await tile(/^Meds/));
  return screen.findByRole('dialog', { name: 'Medication' });
};

describe('the inbox on Now', () => {
  it('shows the doctor cards to an Owner right below the state card', async () => {
    await db.proposals.put(proposal('p1'));
    await db.notes.put(recommendation('r1'));
    await renderNow('Owner');

    const suggestion = await screen.findByRole('region', {
      name: 'Dr. Ana Souza suggested a prescription',
    });
    expect(
      screen.getByRole('region', { name: 'Dr. Ana Souza sent a recommendation' }),
    ).toBeTruthy();
    const stateCard = await screen.findByRole('button', { name: /Fell asleep/ });
    const log = await tile(/^Feed/);
    expect(
      stateCard.compareDocumentPosition(suggestion) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(suggestion.compareDocumentPosition(log) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('is empty when there is nothing from the doctor', async () => {
    await renderNow('Parent');

    await tile(/^Feed/);
    expect(screen.queryByRole('region', { name: 'From your doctor' })).toBeNull();
  });

  it.each<BabyRole>(['Caregiver', 'Viewer', 'Doctor'])(
    'shows a %s no card, with the same data on the device',
    async (role) => {
      await db.proposals.put(proposal('p1'));
      await db.notes.put(recommendation('r1'));
      await renderNow(role);

      await tile(/^Feed/);
      expect(screen.queryByRole('region', { name: 'From your doctor' })).toBeNull();
      expect(screen.queryByRole('button', { name: /^Review/ })).toBeNull();
      expect(screen.queryByRole('button', { name: /Accept|Decline/ })).toBeNull();
    },
  );
});

describe('provenance in the Meds tray', () => {
  it('shows who prescribed it, that a parent changed it, and what the doctor prescribed', async () => {
    await seedPrescriptions();
    await renderNow('Owner');

    const tray = await openTray();
    const colidis = cardOf(tray, 'Colidis');
    const paracetamol = cardOf(tray, 'Paracetamol');
    expect(within(colidis).getByText('Prescribed by Dr. Ana Souza')).toBeTruthy();
    expect(within(colidis).getByText('Self-declared doctor')).toBeTruthy();
    expect(within(colidis).getByText('Changed by parent')).toBeTruthy();
    expect(within(paracetamol).queryByText(/Prescribed by/)).toBeNull();
    expect(within(paracetamol).queryByText('Changed by parent')).toBeNull();

    fireEvent.click(
      within(colidis).getByRole('button', { name: 'See what Dr. Ana Souza prescribed' }),
    );

    const original = await screen.findByRole('dialog', { name: 'What Dr. Ana Souza prescribed' });
    expect(within(original).getByText('Colidis')).toBeTruthy();
    expect(
      within(original).getByText(
        'Give 5 drops, no more often than every 12 hours, when belly pain',
      ),
    ).toBeTruthy();
    expect(within(original).getByText('Only after a feed.')).toBeTruthy();
    expect(within(original).queryByRole('button', { name: /Save|Edit|Stop|Delete/ })).toBeNull();
    expect(within(original).queryByRole('textbox')).toBeNull();
  });

  it('shows the verified badge of a verified professional', async () => {
    const { colidis } = await seedPrescriptions();
    await db.prescriptions.put({ ...colidis, prescribedBy: VERIFIED_ANA, changedByParent: false });
    await renderNow('Owner');

    const tray = await openTray();
    expect(within(tray).getByText('Verified professional')).toBeTruthy();
    expect(within(tray).queryByText('Self-declared doctor')).toBeNull();
    expect(within(tray).queryByText('Changed by parent')).toBeNull();
  });

  it('is read-only for a Caregiver and offers nobody but the Doctor "Propose a change"', async () => {
    await seedPrescriptions();
    await renderNow('Caregiver');

    const tray = await openTray();
    expect(within(tray).getByText('Prescribed by Dr. Ana Souza')).toBeTruthy();
    expect(within(tray).queryByRole('button', { name: /Propose a change/ })).toBeNull();
  });

  it('reads the provenance in Portuguese', async () => {
    await useTestLocale('pt-BR');
    await seedPrescriptions();
    await renderNow('Owner');

    fireEvent.click(await tile(/^Remédios/));
    const tray = await screen.findByRole('dialog', { name: 'Remédio' });
    expect(within(tray).getByText('Prescrito por Dr(a). Ana Souza')).toBeTruthy();
    expect(within(tray).getByText('Alterado pelos pais')).toBeTruthy();
    expect(
      within(tray).getByRole('button', { name: 'Ver o que Dr(a). Ana Souza prescreveu' }),
    ).toBeTruthy();
  });
});

describe('the Doctor in the Meds tray', () => {
  it('opens the tray read-only and proposes a change to a doctor-prescribed prescription', async () => {
    const { colidis } = await seedPrescriptions();
    await renderNow('Doctor');

    const tray = await openTray();
    const colidisCard = cardOf(tray, 'Colidis');
    const paracetamolCard = cardOf(tray, 'Paracetamol');
    for (const log of within(tray).getAllByRole('button', { name: /^Log / })) {
      expect((log as HTMLButtonElement).disabled).toBe(true);
    }
    expect(within(tray).queryByRole('button', { name: 'Add prescription' })).toBeNull();
    expect(within(paracetamolCard).queryByRole('button', { name: /Propose a change/ })).toBeNull();

    fireEvent.click(
      within(colidisCard).getByRole('button', { name: 'Propose a change to Colidis' }),
    );

    const sheet = await screen.findByRole('dialog', { name: 'Propose a change' });
    expect(within(sheet).getByText(/^Changes the current prescription: Give 6 drops/)).toBeTruthy();
    await waitFor(() => expect(screen.queryByLabelText('Loading the date field')).toBeNull());
    fireEvent.click(within(sheet).getByRole('button', { name: 'Send to parents' }));

    await waitFor(async () => expect(await db.proposals.count()).toBe(1));
    expect((await db.proposals.toArray())[0]).toMatchObject({
      status: 'pending',
      replacesPrescriptionId: colidis.id,
      medicationId: 'm-colidis',
      authorUserId: DOCTOR_ID,
    });
    expect(await db.prescriptions.get(colidis.id)).toEqual(colidis);
  });

  it('keeps the other tiles off for her', async () => {
    await renderNow('Doctor');

    expect(((await tile(/^Feed/)) as HTMLButtonElement).disabled).toBe(true);
    expect(((await tile(/^Diaper/)) as HTMLButtonElement).disabled).toBe(true);
    expect(((await tile(/^Meds/)) as HTMLButtonElement).disabled).toBe(false);
  });
});

describe.each(['light', 'dark'] as const)('Now with the inbox in the %s scheme', (scheme) => {
  it.each(['en', 'pt-BR'] as const)(
    'has no accessibility violations in %s, also with the Meds tray open',
    async (locale) => {
      window.localStorage.setItem(THEME_STORAGE_KEY, scheme);
      if (locale === 'pt-BR') await useTestLocale('pt-BR');
      await db.proposals.put(proposal('p1'));
      await db.notes.put(recommendation('r1'));
      await seedPrescriptions();
      await renderNow('Owner');
      await screen.findAllByRole('region');
      expect(await violations()).toEqual([]);

      fireEvent.click(await tile(locale === 'en' ? /^Meds/ : /^Remédios/));
      await screen.findByRole('dialog');
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
