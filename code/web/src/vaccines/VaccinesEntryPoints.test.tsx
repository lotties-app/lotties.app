import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BabyRoutineDb } from '../db/database';
import type { Baby, Vaccination } from '../db/models';
import { NotificationLinkContext } from '../notifications/notificationLinkContext';
import { HubPage } from '../pages/HubPage';
import type { NotificationLink } from '../pwa/sw/deepLink';
import { NowScreen } from '../now/ui/NowScreen';
import { BABY, nowApi, putEvent, seedNow } from '../now/ui/nowKit';
import { BABY_ID, fakeApi, testDatabase } from '../test/fakeApi';
import { useTestLocale } from '../test/locale';
import { renderWithDb, settleSync } from '../test/renderApp';
import { seedBaby } from '../test/seed';
import { TEST_SCHEDULE, seedSchedule } from '../test/vaccineSchedule';
import { VaccinesDue } from './VaccinesDueCard';
import { VaccinesScreen } from './VaccinesScreen';

/*
 * The ways into the vaccines: the "Vaccines due" card on Now (only while a dose is due or overdue),
 * Hub > Vaccines and a vaccine reminder's deep link.
 */

let db: BabyRoutineDb;

/** Thursday 22 October 2026, 10:00 local: the baby is 82 days old. */
const NOW = new Date(2026, 9, 22, 10, 0).getTime();

function record(id: string, doseId: string, givenOn: string): Vaccination {
  return {
    id,
    babyId: BABY_ID,
    vaccineKey: TEST_SCHEDULE.doses.find((d) => d.doseId === doseId)?.vaccineKey ?? null,
    doseId,
    customName: null,
    doseLabel: null,
    givenOn,
    network: 'public',
    clinic: null,
    lot: null,
    administeredBy: null,
    notes: null,
    createdBy: 'u1',
    createdAt: `${givenOn}T12:00:00.000Z`,
    updatedAt: `${givenOn}T12:00:00.000Z`,
    deletedAt: null,
  };
}

/** Gives the live queries time to answer before something is asserted to be absent. */
const settled = () =>
  act(async () => void (await new Promise((resolve) => setTimeout(resolve, 150))));

/** The doses due or overdue on 2026-10-22 for the baby of 82 days (public schedule). */
const DUE_DOSES = ['bcg-1', 'penta-1', 'vip-1', 'rotavirus-1', 'pneumo-conjugada-1'];

beforeEach(async () => {
  db = testDatabase();
  await seedBaby(db);
  await seedSchedule(db);
});

afterEach(async () => {
  vi.useRealTimers();
  await settleSync();
  await db.delete();
});

describe('the Now card', () => {
  it('counts what may be due and names the one waiting longest, then opens the vaccines page', async () => {
    renderWithDb(
      db,
      <Routes>
        <Route path="/" element={<VaccinesDue baby={BABY} now={NOW} />} />
        <Route path="/vaccines" element={<VaccinesScreen baby={BABY} initialNow={NOW} />} />
      </Routes>,
    );

    const card = await screen.findByRole('region', { name: 'Vaccines due' });
    expect(card.textContent).toMatch(/5 vaccines may be due/);
    expect(card.textContent).toContain('BCG · Single dose');
    fireEvent.click(within(card).getByRole('link'));

    expect(await screen.findByRole('heading', { name: 'Vaccines', level: 1 })).toBeTruthy();
  });

  it('says one vaccine in the singular', async () => {
    await db.vaccinations.bulkPut(
      DUE_DOSES.slice(0, 4).map((doseId, i) => record(`r${i}`, doseId, '2026-10-02')),
    );
    renderWithDb(db, <VaccinesDue baby={BABY} now={NOW} />);

    const card = await screen.findByRole('region', { name: 'Vaccines due' });
    expect(card.textContent).toMatch(/1 vaccine may be due/);
    expect(card.textContent).toContain('Pneumococcal conjugate · 1st dose');
  });

  it('is in Portuguese for a Portuguese user', async () => {
    await useTestLocale('pt-BR');
    renderWithDb(db, <VaccinesDue baby={BABY} now={NOW} />);

    const card = await screen.findByRole('region', { name: 'Vacinas previstas' });
    expect(card.textContent).toMatch(/5 vacinas podem estar na época/);
    expect(card.textContent).toContain('BCG · Dose única');
  });

  it('shows nothing once every due dose is recorded', async () => {
    await db.vaccinations.bulkPut(
      DUE_DOSES.map((doseId, i) => record(`r${i}`, doseId, '2026-10-02')),
    );
    renderWithDb(db, <VaccinesDue baby={BABY} now={NOW} />);

    await settled();
    expect(screen.queryByRole('region', { name: 'Vaccines due' })).toBeNull();
  });

  it('shows nothing without a birth date, without the schedule on the device, or before a dose is due', async () => {
    const noBirth: Baby = { ...BABY, birthDate: '' };
    const { unmount } = renderWithDb(db, <VaccinesDue baby={noBirth} now={NOW} />);
    await settled();
    expect(screen.queryByRole('region', { name: 'Vaccines due' })).toBeNull();
    unmount();

    // A birth date after today: nothing can be due yet.
    const unborn: Baby = { ...BABY, birthDate: '2026-12-01' };
    const second = renderWithDb(db, <VaccinesDue baby={unborn} now={NOW} />);
    await settled();
    expect(screen.queryByRole('region', { name: 'Vaccines due' })).toBeNull();
    second.unmount();

    await db.vaccineSchedules.clear();
    renderWithDb(db, <VaccinesDue baby={BABY} now={NOW} />);
    await settled();
    expect(screen.queryByRole('region', { name: 'Vaccines due' })).toBeNull();
  });

  it('sits on the Now screen under the other cards', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    await seedNow(db);
    await putEvent(db, 'feeding', 60, 50);
    const { api } = fakeApi(nowApi(null));
    renderWithDb(db, <NowScreen baby={BABY} />, { api });

    const card = await screen.findByRole('region', { name: 'Vaccines due' });
    expect(card.textContent).toMatch(/5 vaccines may be due/);
    expect(within(card).getByRole('link').getAttribute('href')).toBe('/vaccines');
  });
});

describe('Hub', () => {
  it('has a Vaccines entry that opens the page', async () => {
    renderWithDb(db, <HubPage />, { route: '/hub' });

    const entry = await screen.findByTestId('hub-row-vaccines');
    expect(entry.getAttribute('href')).toBe('/vaccines');
  });
});

describe('a vaccine reminder', () => {
  it('lands on the page for that baby and is handled once', async () => {
    const link: NotificationLink = {
      kind: 'vaccine',
      babyId: BABY_ID,
      deliveryId: '0f8fad5b-d9cb-469f-a165-70867728950e',
    };
    let consumed = 0;
    renderWithDb(
      db,
      <NotificationLinkContext value={{ link, consume: () => (consumed += 1) }}>
        <VaccinesScreen baby={BABY} initialNow={NOW} />
      </NotificationLinkContext>,
    );

    expect(await screen.findByRole('heading', { name: 'Vaccines', level: 1 })).toBeTruthy();
    await waitFor(() => expect(consumed).toBeGreaterThan(0));
  });

  it('leaves a link for another baby or another kind alone', async () => {
    const other: NotificationLink = {
      kind: 'vaccine',
      babyId: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
      deliveryId: '0f8fad5b-d9cb-469f-a165-70867728950e',
    };
    let consumed = 0;
    renderWithDb(
      db,
      <NotificationLinkContext value={{ link: other, consume: () => (consumed += 1) }}>
        <VaccinesScreen baby={BABY} initialNow={NOW} />
      </NotificationLinkContext>,
    );

    await screen.findByRole('heading', { name: 'Vaccines', level: 1 });
    expect(consumed).toBe(0);
  });
});
