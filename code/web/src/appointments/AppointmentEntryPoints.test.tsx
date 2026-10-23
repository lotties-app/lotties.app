import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BabyRoutineDb } from '../db/database';
import type { Appointment } from '../db/models';
import { NotificationLinkContext } from '../notifications/notificationLinkContext';
import { DayPage } from '../pages/DayPage';
import { HubPage } from '../pages/HubPage';
import type { NotificationLink } from '../pwa/sw/deepLink';
import { BABY_ID, testDatabase } from '../test/fakeApi';
import { renderWithDb, settleSync } from '../test/renderApp';
import { seedBaby } from '../test/seed';
import { AppointmentsScreen } from './AppointmentsScreen';
import { NextAppointment } from './NextAppointmentCard';

/*
 * The ways into the appointments: the "Next appointment" card on Now (14 days ahead), the Day
 * strip above the ribbon and the calendar button in the Day header, Hub > Appointments, and
 * an appointment reminder's deep link.
 */

let db: BabyRoutineDb;

const DAY = 86_400_000;

function appointment(id: string, startsAt: string, extra: Partial<Appointment> = {}): Appointment {
  return {
    id,
    babyId: BABY_ID,
    title: id,
    type: 'vaccine',
    startsAt,
    durationMinutes: null,
    location: 'UBS Centro',
    doctorName: null,
    notes: null,
    outcome: null,
    status: 'upcoming',
    reminderOffsetsMinutes: [1440, 120],
    createdBy: 'u1',
    createdAt: startsAt,
    updatedAt: startsAt,
    ...extra,
  };
}

/** Today at `hour`:00 local. */
const todayAt = (hour: number) => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour).toISOString();
};

const BABY = { id: BABY_ID, name: 'Lia', birthDate: '2026-08-01', role: 'Owner' as const };

beforeEach(async () => {
  db = testDatabase();
  await seedBaby(db);
});

afterEach(async () => {
  await settleSync();
  await db.delete();
});

describe('the Now card', () => {
  it('shows the next appointment within 14 days and opens its detail', async () => {
    const now = Date.now();
    await db.appointments.bulkPut([
      appointment('Vaccines 2 months', new Date(now + 3 * DAY).toISOString()),
      appointment('Later', new Date(now + 20 * DAY).toISOString()),
    ]);
    renderWithDb(
      db,
      <Routes>
        <Route path="/" element={<NextAppointment babyId={BABY_ID} now={now} />} />
        <Route path="/appointments" element={<AppointmentsScreen baby={BABY} />} />
      </Routes>,
    );

    const card = await screen.findByRole('region', { name: 'Next appointment' });
    expect(card.textContent).toMatch(/Vaccines 2 months.*in 3 days.*UBS Centro/);
    fireEvent.click(within(card).getByRole('link'));

    expect(await screen.findByRole('dialog', { name: 'Vaccines 2 months' })).toBeTruthy();
  });

  it('shows nothing without an appointment in the next 14 days', async () => {
    const now = Date.now();
    await db.appointments.bulkPut([
      appointment('Later', new Date(now + 20 * DAY).toISOString()),
      appointment('Cancelled', new Date(now + DAY).toISOString(), { status: 'cancelled' }),
    ]);
    renderWithDb(db, <NextAppointment babyId={BABY_ID} now={now} />);

    await waitFor(async () => expect(await db.appointments.count()).toBe(2));
    expect(screen.queryByRole('region', { name: 'Next appointment' })).toBeNull();
  });
});

describe('the Day screen', () => {
  it('lists the day’s appointments above the ribbon and opens the detail', async () => {
    await db.appointments.bulkPut([
      appointment('Hearing test', todayAt(23), { type: 'exam' }),
      appointment('Tomorrow', new Date(Date.now() + 2 * DAY).toISOString()),
    ]);
    renderWithDb(db, <DayPage />);

    const strip = await screen.findByRole('region', { name: 'Appointments of the day' });
    expect(within(strip).getAllByRole('listitem')).toHaveLength(1);
    fireEvent.click(within(strip).getByRole('button', { name: /Hearing test/ }));
    expect(await screen.findByRole('dialog', { name: 'Hearing test' })).toBeTruthy();
  });

  it('links the header calendar button to the appointments page', async () => {
    renderWithDb(db, <DayPage />);

    const button = await screen.findByRole('link', { name: 'Appointments calendar' });
    expect(button.getAttribute('href')).toBe('/appointments');
  });
});

describe('Hub', () => {
  it('has an Appointments entry that opens the page', async () => {
    renderWithDb(db, <HubPage />, { route: '/hub' });

    const entry = await screen.findByTestId('hub-row-appointments');
    expect(entry.getAttribute('href')).toBe('/appointments');
  });
});

describe('an appointment reminder', () => {
  it('opens the appointment it points at, once, for that baby', async () => {
    await db.appointments.bulkPut([appointment('Pediatrician', todayAt(23))]);
    const link: NotificationLink = {
      kind: 'appt',
      babyId: BABY_ID,
      appointmentId: 'Pediatrician',
      deliveryId: '0f8fad5b-d9cb-469f-a165-70867728950e',
    };
    let consumed = 0;
    renderWithDb(
      db,
      <NotificationLinkContext value={{ link, consume: () => (consumed += 1) }}>
        <AppointmentsScreen baby={BABY} />
      </NotificationLinkContext>,
    );

    expect(await screen.findByRole('dialog', { name: 'Pediatrician' })).toBeTruthy();
    await waitFor(() => expect(consumed).toBeGreaterThan(0));
  });
});
