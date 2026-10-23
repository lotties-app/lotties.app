import { screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BabyRoutineDb } from '../db/database';
import type { BabyRole } from '../db/models';
import type { MeasurementDto } from '../sync/contract';
import { BABY_ID, fakeApi, testDatabase } from '../test/fakeApi';
import { useTestLocale } from '../test/locale';
import { renderWithDb, settleSync } from '../test/renderApp';
import { seedBaby } from '../test/seed';
import { Growth, GrowthPage } from './GrowthPage';

/* Consultation measurements (docs/design/16-doctor-access.md): "Recorded by Dr.", the doctor's own. */

let db: BabyRoutineDb;

const DOCTOR = 'doctor-1';
const ANA = {
  userId: DOCTOR,
  displayName: 'Ana Souza',
  professional: { kind: 'doctor', displayName: 'Dra. Ana Souza', verified: false },
};

const measurement = (
  id: string,
  date: string,
  extra: Partial<MeasurementDto> = {},
): MeasurementDto => ({
  id,
  babyId: BABY_ID,
  date,
  weightKg: 5.4,
  heightCm: null,
  headCircumferenceCm: null,
  notes: null,
  createdBy: 'mom',
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  ...extra,
});

const SERVER = [
  measurement('m-doc', '2026-10-10', {
    createdBy: DOCTOR,
    recordedByDoctor: true,
    recordedBy: ANA,
  }),
  measurement('m-mom', '2026-09-10', { recordedByDoctor: false, recordedBy: null }),
];

beforeEach(() => {
  db = testDatabase();
});

afterEach(async () => {
  await settleSync();
  await db.delete();
});

async function renderGrowth(role: BabyRole) {
  const userId = role === 'Doctor' ? DOCTOR : 'mom';
  await seedBaby(db, { role, userId });
  const fake = fakeApi((call) => (call.path.endsWith('/measurements') ? SERVER : undefined));
  // The doctor's growth page lives in her dashboard: the parents' pages never show her patients.
  const ui =
    role === 'Doctor' ? (
      <Growth
        baby={{ id: BABY_ID, name: 'Lia', birthDate: '2026-08-01', role, userId }}
        heading="h1"
      />
    ) : (
      <GrowthPage />
    );
  renderWithDb(db, ui, { api: fake.api });
}

describe('growth with a doctor', () => {
  it('shows who recorded a consultation measurement to the parents, who change any', async () => {
    await renderGrowth('Owner');

    const list = await screen.findByRole('list', { name: 'Measurements' });
    const [doc, mom] = within(list).getAllByRole('listitem');
    expect(doc.textContent).toContain('Recorded by Dr. Ana Souza (self-declared doctor)');
    expect(mom.textContent).not.toContain('Recorded by');
    expect(within(doc).getByRole('button', { name: /^Delete measurement/ })).toBeTruthy();
    expect(within(mom).getByRole('button', { name: /^Delete measurement/ })).toBeTruthy();
  });

  it('lets the doctor add measurements and change only her own', async () => {
    await renderGrowth('Doctor');

    expect(await screen.findByRole('button', { name: 'Add measurement' })).toBeTruthy();
    expect(screen.getByText(/you can add consultation measurements/)).toBeTruthy();
    const list = await screen.findByRole('list', { name: 'Measurements' });
    const [doc, mom] = within(list).getAllByRole('listitem');
    expect(within(doc).getByRole('button', { name: /^Edit measurement/ })).toBeTruthy();
    expect(within(mom).queryByRole('button')).toBeNull();
  });

  it('keeps Viewers read-only', async () => {
    await renderGrowth('Viewer');

    await screen.findByRole('list', { name: 'Measurements' });
    expect(screen.queryByRole('button', { name: 'Add measurement' })).toBeNull();
  });

  it('reads "Registrado por Dr(a)." in pt-BR', async () => {
    await useTestLocale('pt-BR');
    await renderGrowth('Owner');

    const list = await screen.findByRole('list', { name: 'Medidas' });
    expect(list.textContent).toContain(
      'Registrado por Dr(a). Ana Souza (médico(a) autodeclarado(a))',
    );
  });
});
