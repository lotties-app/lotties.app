import { screen, waitFor } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BabyRoutineDb } from '../db/database';
import type { Appointment, Baby, BabyRole } from '../db/models';
import { nowApi, BABY as NOW_BABY, seedMorning, seedNow } from '../now/ui/nowKit';
import { NowScreen } from '../now/ui/NowScreen';
import { AppointmentsPage } from '../pages/AppointmentsPage';
import { DayPage } from '../pages/DayPage';
import { SettingsPage } from '../pages/SettingsPage';
import { BABY_ID, fakeApi, testDatabase, type ApiCall } from '../test/fakeApi';
import { renderWithDb, settleSync } from '../test/renderApp';
import { seedBaby } from '../test/seed';

/*
 * A Doctor never sees the family's appointments (docs/design/16-doctor-access.md, "Doctor read
 * audit"): no "Next appointment" card on Now, no Day strip nor calendar button, no Settings entry,
 * `/appointments` sends her to her patients; and no members list. The family roles keep them all.
 */

let db: BabyRoutineDb;

const DAY = 86_400_000;

function appointment(id: string, startsAt: string): Appointment {
  return {
    id,
    babyId: BABY_ID,
    title: id,
    type: 'consultation',
    startsAt,
    durationMinutes: null,
    location: 'Clinic Central',
    doctorName: 'Dr. Other',
    notes: null,
    outcome: null,
    status: 'upcoming',
    reminderOffsetsMinutes: [1440, 120],
    createdBy: 'u1',
    createdAt: startsAt,
    updatedAt: startsAt,
  };
}

/** Today at `hour`:00 local. */
const todayAt = (hour: number) => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour).toISOString();
};

const askedForMembers = (calls: ApiCall[]) => calls.some((c) => c.path.includes('/members'));

beforeEach(() => {
  db = testDatabase();
  window.localStorage.clear();
});

afterEach(async () => {
  await settleSync();
  await db.delete();
});

async function renderNow(role: BabyRole) {
  const baby: Baby = { ...NOW_BABY, role };
  await seedNow(db, { role });
  await db.babies.put(baby);
  await seedMorning(db, 112);
  await db.appointments.put(
    appointment('Second opinion', new Date(Date.now() + 3 * DAY).toISOString()),
  );
  const fake = fakeApi(nowApi());
  renderWithDb(db, <NowScreen baby={baby} />, { api: fake.api });
  return fake;
}

describe('Now', () => {
  it('shows a Doctor no "Next appointment" card and never asks her for the members', async () => {
    const { calls } = await renderNow('Doctor');

    await screen.findByRole('button', { name: /^Feed/ });
    expect(screen.queryByRole('region', { name: 'Next appointment' })).toBeNull();
    expect(screen.queryByText('Second opinion')).toBeNull();
    expect(askedForMembers(calls)).toBe(false);
  });

  it.each<BabyRole>(['Owner', 'Viewer'])('still shows the card to a %s', async (role) => {
    await renderNow(role);

    expect(await screen.findByRole('region', { name: 'Next appointment' })).toBeTruthy();
  });
});

describe('Day', () => {
  it('shows a Doctor no appointments strip and no calendar button', async () => {
    await seedBaby(db, { role: 'Doctor' });
    await db.appointments.put(appointment('Second opinion', todayAt(23)));
    const fake = fakeApi();
    renderWithDb(db, <DayPage />, { api: fake.api });

    await screen.findByRole('button', { name: /Filter/ });
    expect(screen.queryByRole('region', { name: 'Appointments of the day' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Appointments calendar' })).toBeNull();
    expect(screen.queryByText('Second opinion')).toBeNull();
    expect(askedForMembers(fake.calls)).toBe(false);
  });

  it('keeps both for a Caregiver', async () => {
    await seedBaby(db, { role: 'Caregiver' });
    await db.appointments.put(appointment('Second opinion', todayAt(23)));
    renderWithDb(db, <DayPage />);

    expect(await screen.findByRole('region', { name: 'Appointments of the day' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Appointments calendar' })).toBeTruthy();
  });
});

describe('Settings', () => {
  it('has no Appointments entry and no members list for a Doctor, who can still leave', async () => {
    await seedBaby(db, { role: 'Doctor' });
    const fake = fakeApi();
    renderWithDb(db, <SettingsPage />, { route: '/settings#members', api: fake.api });

    expect(await screen.findByRole('button', { name: 'Leave this baby' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: /^Appointments/ })).toBeNull();
    expect(screen.queryByRole('list', { name: 'Members' })).toBeNull();
    expect(screen.queryByText('Only the owner can manage members and invites.')).toBeNull();
    await settleSync();
    expect(askedForMembers(fake.calls)).toBe(false);
  });

  it('keeps the entry and the members list for a Viewer', async () => {
    await seedBaby(db, { role: 'Viewer' });
    const fake = fakeApi();
    renderWithDb(db, <SettingsPage />, { route: '/settings#members', api: fake.api });

    expect(await screen.findByRole('link', { name: /^Appointments/ })).toBeTruthy();
    expect(await screen.findByRole('list', { name: 'Members' })).toBeTruthy();
    await waitFor(() => expect(askedForMembers(fake.calls)).toBe(true));
  });
});

describe('the /appointments route', () => {
  function renderRoute() {
    renderWithDb(
      db,
      <Routes>
        <Route path="/appointments" element={<AppointmentsPage />} />
        <Route path="/patients" element={<p>Patients page</p>} />
      </Routes>,
      { route: '/appointments' },
    );
  }

  it('sends a Doctor to her patients without ever showing the calendar', async () => {
    await seedBaby(db, { role: 'Doctor' });
    await db.appointments.put(appointment('Second opinion', todayAt(23)));
    renderRoute();
    expect(screen.queryByText('Second opinion')).toBeNull();

    expect(await screen.findByText('Patients page')).toBeTruthy();
    expect(screen.queryByText('Second opinion')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Appointments' })).toBeNull();
  });

  it('opens the calendar for a Parent', async () => {
    await seedBaby(db, { role: 'Parent' });
    renderRoute();

    await waitFor(() => expect(screen.queryByText('Patients page')).toBeNull());
    expect(await screen.findByRole('heading', { name: 'Appointments' })).toBeTruthy();
  });
});
