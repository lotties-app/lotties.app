import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BabyRoutineDb } from '../db/database';
import type { Prescription, PrescriptionOriginal } from '../db/models';
import { setPrescriptionStatus, updatePrescription, termsOf } from '../db/prescriptionCommands';
import { PrescriptionSheet } from '../medications/PrescriptionSheet';
import { prescription } from '../medications/prescriptionFixtures';
import { SelfDeclaredBadge } from '../professional/DoctorName';
import { BABY_ID, fakeApi, testDatabase } from '../test/fakeApi';
import { useTestLocale } from '../test/locale';
import { renderWithDb, settleSync } from '../test/renderApp';
import { seedBaby } from '../test/seed';
import { THEME_STORAGE_KEY } from '../theme/themeStorage';
import { ANA, VERIFIED_ANA } from './proposalKit';
import { Provenance } from './Provenance';

/*
 * Provenance of a prescription a doctor suggested (docs/design/16-doctor-access.md section 10.2) and
 * the verified badge (section 10.6): "Prescribed by Dr. ...", "Changed by parent" and a read-only
 * look at what the doctor prescribed.
 */

let db: BabyRoutineDb;

beforeEach(async () => {
  db = testDatabase();
  window.localStorage.clear();
  await seedBaby(db, { medications: true });
});

afterEach(async () => {
  await settleSync();
  await db.delete();
});

const ORIGINAL: PrescriptionOriginal = {
  medicationName: 'Zeta syrup',
  productId: null,
  kind: 'scheduled',
  dose: { amount: 1, unit: 'drop', perKg: false, roundingStep: null },
  timesOfDay: null,
  everyMinutes: null,
  dayParts: ['morning'],
  dayPartReminders: null,
  minIntervalMinutes: null,
  maxDosesPer24h: null,
  indication: null,
  intervalGroup: null,
  startDate: '2026-10-01',
  endDate: '2026-12-01',
  instructions: 'With the first feed.',
};

const sourced = (extra: Partial<Prescription> = {}): Prescription =>
  prescription({
    id: 'rx-1',
    babyId: BABY_ID,
    medicationId: 'm-z',
    prescribedByUserId: 'doctor-1',
    prescribedByName: 'Ana Souza',
    prescribedBy: ANA,
    proposalId: 'p1',
    changedByParent: false,
    original: ORIGINAL,
    ...extra,
  });

describe('the provenance line', () => {
  it('says who prescribed it, with the self-declared badge', async () => {
    renderWithDb(db, <Provenance prescription={sourced()} />);

    expect(await screen.findByText('Prescribed by Dr. Ana Souza')).toBeTruthy();
    expect(screen.getByText('Self-declared doctor')).toBeTruthy();
    expect(screen.queryByText('Changed by parent')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('says "Verified professional" with a check when the profile is verified', async () => {
    renderWithDb(db, <Provenance prescription={sourced({ prescribedBy: VERIFIED_ANA })} />);

    const badge = await screen.findByText('Verified professional');
    expect(badge.closest('.MuiChip-root')?.querySelector('[data-icon="success"]')).toBeTruthy();
    expect(screen.queryByText('Self-declared doctor')).toBeNull();
  });

  it('falls back to the name the doctor had when the parents accepted', async () => {
    renderWithDb(db, <Provenance prescription={sourced({ prescribedBy: null })} />);

    expect(await screen.findByText('Prescribed by Dr. Ana Souza')).toBeTruthy();
    expect(screen.getByText('Self-declared doctor')).toBeTruthy();
  });

  it('drops a title the doctor typed herself', async () => {
    renderWithDb(
      db,
      <Provenance
        prescription={sourced({
          prescribedBy: {
            ...ANA,
            displayName: 'Dra. Ana',
            professional: { ...ANA.professional!, displayName: 'Dra. Ana' },
          },
        })}
      />,
    );

    expect(await screen.findByText('Prescribed by Dr. Ana')).toBeTruthy();
  });

  it('shows nothing for a prescription the parents entered', () => {
    const { container } = renderWithDb(db, <Provenance prescription={prescription()} />);

    expect(container.textContent).toBe('');
  });

  it('says it was changed by a parent and opens what the doctor prescribed, read-only', async () => {
    renderWithDb(db, <Provenance prescription={sourced({ changedByParent: true })} />);

    expect(await screen.findByText('Changed by parent')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'See what Dr. Ana Souza prescribed' }));

    const sheet = await screen.findByRole('dialog', { name: 'What Dr. Ana Souza prescribed' });
    expect(within(sheet).getByText('Zeta syrup')).toBeTruthy();
    expect(within(sheet).getByText('Give 1 drop, in the morning, until Dec 1, 2026')).toBeTruthy();
    expect(within(sheet).getByText('From Oct 1, 2026 to Dec 1, 2026')).toBeTruthy();
    expect(within(sheet).getByText('With the first feed.')).toBeTruthy();
    expect(within(sheet).queryByRole('textbox')).toBeNull();
    expect(within(sheet).queryByRole('button', { name: /Save|Edit|Stop|Delete/ })).toBeNull();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('has no link without the original', async () => {
    renderWithDb(
      db,
      <Provenance prescription={sourced({ changedByParent: true, original: null })} />,
    );

    expect(await screen.findByText('Changed by parent')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('reads in Portuguese', async () => {
    await useTestLocale('pt-BR');
    renderWithDb(db, <Provenance prescription={sourced({ changedByParent: true })} />);

    expect(await screen.findByText('Prescrito por Dr(a). Ana Souza')).toBeTruthy();
    expect(screen.getByText('Alterado pelos pais')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Ver o que Dr(a). Ana Souza prescreveu' }));
    expect(
      await screen.findByRole('dialog', { name: 'O que Dr(a). Ana Souza prescreveu' }),
    ).toBeTruthy();
  });
});

describe('the verified badge', () => {
  it('is self-declared by default', () => {
    renderWithDb(db, <SelfDeclaredBadge />);

    expect(screen.getByText('Self-declared doctor')).toBeTruthy();
    expect(screen.queryByText('Verified professional')).toBeNull();
  });

  it('is verified only when told so', () => {
    renderWithDb(db, <SelfDeclaredBadge verified />);

    expect(screen.getByText('Verified professional')).toBeTruthy();
    expect(screen.queryByText('Self-declared doctor')).toBeNull();
  });

  it('reads Profissional verificado in Portuguese', async () => {
    await useTestLocale('pt-BR');
    renderWithDb(db, <SelfDeclaredBadge verified />);

    expect(await screen.findByText('Profissional verificado')).toBeTruthy();
  });
});

describe('in the prescription editor', () => {
  it('shows the provenance of a doctor-sourced prescription to the parents', async () => {
    renderWithDb(
      db,
      <PrescriptionSheet
        babyId={BABY_ID}
        prescription={sourced({ changedByParent: true })}
        onDone={() => {}}
      />,
    );

    const sheet = await screen.findByRole('dialog', { name: 'Edit prescription' });
    expect(within(sheet).getByText('Prescribed by Dr. Ana Souza')).toBeTruthy();
    expect(within(sheet).getByText('Changed by parent')).toBeTruthy();
    expect(
      within(sheet).getByRole('button', { name: 'See what Dr. Ana Souza prescribed' }),
    ).toBeTruthy();
  });

  it('shows nothing extra when the parents entered the prescription', async () => {
    renderWithDb(
      db,
      <PrescriptionSheet
        babyId={BABY_ID}
        prescription={prescription({ id: 'rx-own', babyId: BABY_ID, medicationId: 'm-z' })}
        onDone={() => {}}
      />,
    );

    const sheet = await screen.findByRole('dialog', { name: 'Edit prescription' });
    expect(within(sheet).queryByText(/Prescribed by Dr/)).toBeNull();
  });
});

describe('a parent edits a doctor-sourced prescription', () => {
  async function seeded() {
    const rx = sourced({ dose: { amount: 2, unit: 'ml', perKg: false, roundingStep: null } });
    await db.prescriptions.put(rx);
    return rx;
  }

  it('flags it changed at once when the content changes, and keeps the original and the provenance', async () => {
    const rx = await seeded();

    await updatePrescription(db, rx.id, {
      ...termsOf(rx),
      dose: { amount: 3, unit: 'ml', perKg: false, roundingStep: null },
    });

    expect(await db.prescriptions.get(rx.id)).toMatchObject({
      changedByParent: true,
      prescribedByName: 'Ana Souza',
      proposalId: 'p1',
      original: ORIGINAL,
    });
    const [queued] = await db.outbox.toArray();
    expect(queued.payload).not.toHaveProperty('changedByParent');
    expect(queued.payload).not.toHaveProperty('original');
  });

  it('does not flag stopping, resuming or an edit that changes nothing', async () => {
    const rx = await seeded();

    await setPrescriptionStatus(db, rx.id, 'stopped');
    await setPrescriptionStatus(db, rx.id, 'active');
    await updatePrescription(db, rx.id, termsOf(rx));

    expect((await db.prescriptions.get(rx.id))?.changedByParent).toBe(false);
  });

  it('never flags a prescription the parents entered', async () => {
    const own = prescription({ id: 'rx-own', babyId: BABY_ID, medicationId: 'm-z' });
    await db.prescriptions.put(own);

    await updatePrescription(db, own.id, {
      ...termsOf(own),
      dose: { amount: 9, unit: 'ml', perKg: false, roundingStep: null },
    });

    expect((await db.prescriptions.get(own.id))?.changedByParent).toBeUndefined();
  });
});

describe.each(['light', 'dark'] as const)('the provenance in the %s scheme', (scheme) => {
  it.each(['en', 'pt-BR'] as const)('has no accessibility violations in %s', async (locale) => {
    window.localStorage.setItem(THEME_STORAGE_KEY, scheme);
    if (locale === 'pt-BR') await useTestLocale('pt-BR');
    renderWithDb(db, <Provenance prescription={sourced({ changedByParent: true })} />, {
      api: fakeApi().api,
    });
    await screen.findByTestId('provenance');
    fireEvent.click(screen.getByRole('button', { name: /^(See what|Ver o que)/ }));
    await screen.findByRole('dialog');

    const result = await axe.run(document.body, {
      runOnly: ['wcag2a', 'wcag2aa'],
      rules: { 'color-contrast': { enabled: false } },
    });
    expect(result.violations.map((v) => v.id)).toEqual([]);
  });
});
