import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppRoutes } from '../AppRoutes';
import type { BabyRoutineDb } from '../db/database';
import type { Baby, BabyEvent, Note } from '../db/models';
import { readSelectedBabyId } from '../baby/selectedBabyStorage';
import { fakeApi, testDatabase } from '../test/fakeApi';
import { useTestLocale } from '../test/locale';
import { renderWithDb, settleSync } from '../test/renderApp';
import { EVENT_TYPES } from '../test/seed';
import { THEME_STORAGE_KEY } from '../theme/themeStorage';
import { patientBabies } from './patientsModel';

/* The doctor's Patients (docs/design/16-doctor-access.md) and the read-only shell for her. */

let db: BabyRoutineDb;

const DOCTOR = 'doctor-1';
const baby = (id: string, name: string, role: Baby['role']): Baby => ({
  id,
  name,
  birthDate: '2026-08-01',
  role,
  userId: role === 'Doctor' ? DOCTOR : 'me',
});

const event = (babyId: string, startedAt: string, deletedAt: string | null = null): BabyEvent => ({
  id: `${babyId}-${startedAt}`,
  babyId,
  typeId: EVENT_TYPES[0].id,
  startedAt,
  endedAt: startedAt,
  payload: {},
  notes: null,
  createdBy: 'mom',
  createdAt: startedAt,
  updatedAt: startedAt,
  deletedAt,
});

const note = (id: string, babyId: string, extra: Partial<Note> = {}): Note => ({
  id,
  babyId,
  authorUserId: DOCTOR,
  author: null,
  kind: 'note',
  visibility: 'shared',
  body: 'x',
  createdAt: '2026-10-20T10:00:00.000Z',
  updatedAt: '2026-10-20T10:00:00.000Z',
  deletedAt: null,
  ...extra,
});

function babiesApi(babies: Baby[]) {
  return fakeApi((call) => (call.path === '/api/v1/babies' ? babies : undefined)).api;
}

beforeEach(() => {
  db = testDatabase();
  window.sessionStorage.clear();
});

afterEach(async () => {
  await settleSync();
  await db.delete();
});

async function seedPatients() {
  const babies = [baby('b-theo', 'Theo', 'Doctor'), baby('b-lia', 'Lia', 'Doctor')];
  await db.babies.bulkPut(babies);
  await db.eventTypes.bulkPut(EVENT_TYPES);
  const recent = new Date(Date.now() - 2 * 3_600_000).toISOString();
  await db.events.bulkPut([
    event('b-lia', recent),
    event('b-lia', new Date(Date.now() - 600_000).toISOString(), new Date().toISOString()),
  ]);
  await db.notes.bulkPut([
    note('n1', 'b-lia'),
    note('n2', 'b-lia'),
    note('n3', 'b-lia', { visibility: 'private' }),
    note('n4', 'b-lia', { deletedAt: '2026-10-21T10:00:00.000Z' }),
    note('n5', 'b-theo', { authorUserId: 'other-doctor' }),
  ]);
  return babies;
}

describe('patients', () => {
  it('keeps only the babies where the user is the Doctor, by name', () => {
    expect(
      patientBabies([
        baby('a', 'Zoe', 'Doctor'),
        baby('b', 'Ana', 'Owner'),
        baby('c', 'Bia', 'Doctor'),
      ]).map((b) => b.name),
    ).toEqual(['Bia', 'Zoe']);
  });

  it('is the landing page of a doctor without a baby of her own, with age, last entry and her shared notes', async () => {
    const babies = await seedPatients();
    renderWithDb(db, <AppRoutes />, { route: '/', api: babiesApi(babies) });

    const list = await screen.findByRole('list', { name: 'Patients' });
    const rows = await within(list).findAllByRole('listitem');
    expect(rows.map((row) => within(row).getByRole('heading').textContent)).toEqual([
      'Lia',
      'Theo',
    ]);
    await waitFor(() => expect(within(rows[0]).getByText('Last entry 2 hours ago')).toBeTruthy());
    expect(within(rows[0]).getByText('2 shared notes by you')).toBeTruthy();
    expect(within(rows[1]).getByText('Nothing logged yet')).toBeTruthy();
    expect(within(rows[1]).getByText('0 shared notes by you')).toBeTruthy();
  });

  it('opens a patient into the read-only views: no add button, Now readable', async () => {
    const babies = await seedPatients();
    renderWithDb(db, <AppRoutes />, { route: '/patients', api: babiesApi(babies) });

    fireEvent.click(await screen.findByRole('button', { name: 'Open Theo' }));

    const nav = await screen.findByRole('navigation', { name: 'Main' });
    expect(within(nav).getAllByRole('link')).toHaveLength(4);
    expect(within(nav).queryByRole('button', { name: 'Add event' })).toBeNull();
    expect(readSelectedBabyId()).toBe('b-theo');
    expect(await screen.findByText(/view-only access/)).toBeTruthy();
  });

  it('is a Settings entry for a user who also has a baby of her own', async () => {
    const babies = [baby('b-own', 'Ana', 'Owner'), baby('b-lia', 'Lia', 'Doctor')];
    await db.babies.bulkPut(babies);
    renderWithDb(db, <AppRoutes />, { route: '/settings', api: babiesApi(babies) });

    const link = await screen.findByRole('link', { name: 'Patients' });
    expect(link.getAttribute('href')).toBe('/patients');
    expect(screen.getByRole('button', { name: "I'm a healthcare professional" })).toBeTruthy();
  });

  it('reads Pacientes in pt-BR', async () => {
    await useTestLocale('pt-BR');
    const babies = await seedPatients();
    renderWithDb(db, <AppRoutes />, { route: '/patients', api: babiesApi(babies) });

    expect(await screen.findByRole('heading', { name: 'Pacientes', level: 1 })).toBeTruthy();
    expect(await screen.findByText('2 notas compartilhadas suas')).toBeTruthy();
  });

  it.each(['light', 'dark'] as const)(
    'has no accessibility violations (%s)',
    async (scheme) => {
      window.localStorage.setItem(THEME_STORAGE_KEY, scheme);
      const babies = await seedPatients();
      renderWithDb(db, <AppRoutes />, { route: '/patients', api: babiesApi(babies) });
      await screen.findAllByRole('listitem');
      const result = await axe.run(document.body, {
        runOnly: ['wcag2a', 'wcag2aa'],
        rules: { 'color-contrast': { enabled: false } },
      });
      expect(result.violations.map((v) => v.id)).toEqual([]);
    },
    60_000,
  );
});
