import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppRoutes } from '../AppRoutes';
import { readSelectedBabyId } from '../baby/selectedBabyStorage';
import type { Baby, BabyRole } from '../db/models';
import type { BabyRoutineDb } from '../db/database';
import { deepLinkUrl } from '../pwa/sw/deepLink';
import { BABY_ID, fakeApi, testDatabase } from '../test/fakeApi';
import { renderWithDb, settleSync } from '../test/renderApp';
import { EVENT_TYPES } from '../test/seed';
import { DOCTOR_ID, MEMBERS, babyFor, proposal, recommendation } from './proposalKit';

/*
 * The routes of the doctor's proposals (docs/design/16-doctor-access.md section 10): `/proposals`
 * for the Doctor, `/from-doctor` for the parents (also where a doctor-suggestion notification
 * lands), their Settings entries and the Patients shortcut.
 */

let db: BabyRoutineDb;

beforeEach(() => {
  db = testDatabase();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

afterEach(async () => {
  await settleSync();
  window.history.replaceState(null, '', '/');
  await db.delete();
});

async function renderApp(role: BabyRole, route: string, babies?: Baby[]) {
  const list = babies ?? [babyFor(role)];
  await db.babies.bulkPut(list);
  await db.eventTypes.bulkPut(EVENT_TYPES);
  const fake = fakeApi((call) => {
    if (call.path === '/api/v1/babies') return list;
    if (call.path.endsWith('/members')) return MEMBERS;
    return undefined;
  });
  return renderWithDb(db, <AppRoutes />, { route, api: fake.api });
}

describe('the Doctor', () => {
  it("finds a patient's proposals under Medications in her dashboard", async () => {
    await db.proposals.bulkPut([proposal('p1'), proposal('p2', { medicationName: 'Vitamin D' })]);
    await renderApp('Doctor', `/doctor/${BABY_ID}/medications`);

    expect(await screen.findByRole('heading', { name: 'Medications', level: 1 })).toBeTruthy();
    expect(await screen.findByRole('heading', { name: 'My proposals', level: 2 })).toBeTruthy();
    expect(await screen.findByRole('list', { name: 'Proposals, newest first' })).toBeTruthy();
    expect(screen.getByText('Vitamin D')).toBeTruthy();
    expect(readSelectedBabyId()).toBeNull();
  });

  it('finds her patients in the Hub, with no inbox and no baby of the family', async () => {
    await renderApp('Doctor', '/hub');

    const link = await screen.findByTestId('hub-row-patients');
    expect(link.getAttribute('href')).toBe('/doctor');
    expect(screen.queryByTestId('hub-row-fromDoctor')).toBeNull();
    expect(screen.queryByTestId('hub-row-myProposals')).toBeNull();
    expect(screen.queryByTestId('hub-row-appointments')).toBeNull();
  });

  it('reads no "create a baby" prompt in Settings', async () => {
    await renderApp('Doctor', '/settings');

    expect(await screen.findByRole('heading', { name: 'Settings', level: 1 })).toBeTruthy();
    expect(screen.queryByText(/unlock these settings/)).toBeNull();
  });

  it.each(['/from-doctor', '/proposals', '/patients', '/notes', '/'])(
    "is sent from %s to her dashboard, never to the parents' pages",
    async (route) => {
      await renderApp('Doctor', route);

      expect(await screen.findByRole('heading', { name: 'Patients', level: 1 })).toBeTruthy();
      const nav = screen.getByRole('navigation', { name: 'Doctor dashboard' });
      expect(within(nav).getByRole('link', { name: 'Patients' }).getAttribute('aria-current')).toBe(
        'page',
      );
    },
  );
});

describe('the parents', () => {
  it('see what the doctor sent on /from-doctor and find it in the Hub with its badge', async () => {
    await db.proposals.put(proposal('p1', { authorUserId: DOCTOR_ID }));
    await db.notes.put(recommendation('r1'));
    await renderApp('Owner', '/hub');

    const link = await screen.findByTestId('hub-row-fromDoctor');
    expect(link.getAttribute('href')).toBe('/from-doctor');
    await waitFor(() => expect(link.textContent).toContain('2 need attention'));
    expect(screen.getByTestId('hub-row-notes').textContent).toContain('1 needs attention');

    fireEvent.click(link);

    expect(await screen.findByRole('heading', { name: 'From your doctor', level: 1 })).toBeTruthy();
    expect(await screen.findByText('Colidis')).toBeTruthy();
  });

  it('are sent from /proposals to /from-doctor', async () => {
    await renderApp('Parent', '/proposals');

    expect(await screen.findByRole('heading', { name: 'From your doctor', level: 1 })).toBeTruthy();
  });

  it('land on "From your doctor" from a doctor-suggestion notification, select the baby and strip the link', async () => {
    const baby: Baby = { ...babyFor('Owner'), id: GUID_BABY };
    await db.proposals.put(proposal('p1', { babyId: GUID_BABY }));
    const url = deepLinkUrl({ kind: 'doctor', babyId: GUID_BABY, deliveryId: DELIVERY });
    window.history.replaceState(null, '', url);
    await renderApp('Owner', url, [baby]);

    expect(await screen.findByRole('heading', { name: 'From your doctor', level: 1 })).toBeTruthy();
    const waiting = await screen.findByRole('region', { name: 'Waiting for you' });
    expect(within(waiting).getByText('Colidis')).toBeTruthy();
    await waitFor(() => expect(readSelectedBabyId()).toBe(GUID_BABY));
    expect(window.location.hash).toBe('');
  });
});

const GUID_BABY = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const DELIVERY = '0f8fad5b-d9cb-469f-a165-70867728950e';
