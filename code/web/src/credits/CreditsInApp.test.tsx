import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppRoutes } from '../AppRoutes';
import type { BabyRoutineDb } from '../db/database';
import { patientBaby, patientDto, renderDashboard } from '../doctor/dashboardTestKit';
import { HubPage } from '../pages/HubPage';
import { seedFamily } from '../proposals/proposalKit';
import { fakeApi, testDatabase } from '../test/fakeApi';
import { renderWithDb, settleSync } from '../test/renderApp';
import { seedBaby } from '../test/seed';

/* The credits inside the signed-in app: the Hub entry, the Hub page, About, and the doctor's shell. */

let db: BabyRoutineDb;

beforeEach(() => {
  db = testDatabase();
  window.localStorage.clear();
});

afterEach(async () => {
  await settleSync();
  await db.delete();
});

describe('Hub > App > Credits and licenses', () => {
  it('is listed in the App section and opens the credits inside the shell', async () => {
    await seedFamily(db, 'Viewer');
    renderWithDb(db, <AppRoutes />, { route: '/hub' });
    const row = await screen.findByTestId('hub-row-credits');
    expect(row.getAttribute('href')).toBe('/hub/credits');
    expect(row.textContent).toContain('Credits and licenses');
    fireEvent.click(row);
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Credits and licenses' }),
    ).toBeTruthy();
    // The app shell is still around the page (its navigation), and a way back to the Hub.
    expect(screen.getByRole('navigation')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Back to Hub' })).toBeTruthy();
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Our license and source' }),
    ).toBeTruthy();
  });

  it('is found by searching the Hub', async () => {
    await seedFamily(db, 'Owner');
    renderWithDb(db, <HubPage />, { api: fakeApi().api, route: '/hub' });
    fireEvent.change(await screen.findByRole('searchbox'), { target: { value: 'open source' } });
    expect(screen.getAllByTestId(/^hub-row-/).map((r) => r.getAttribute('data-testid'))).toEqual([
      'hub-row-credits',
    ]);
  });

  it('is linked from About', async () => {
    await seedBaby(db);
    renderWithDb(db, <AppRoutes />, { route: '/hub/about' });
    const link = await screen.findByRole('link', {
      name: 'Built on open source. Credits and licenses',
    });
    expect(link.getAttribute('href')).toBe('/hub/credits');
  });
});

describe("the doctor's shell", () => {
  const LIA = patientBaby('lia', 'Lia', '2026-08-01');

  it('opens the credits at /doctor/credits inside her own navigation', async () => {
    await renderDashboard(db, '/doctor/credits', [LIA], (call) =>
      call.path.split('?')[0] === '/api/v1/doctor/patients' ? [patientDto(LIA)] : undefined,
    );
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Credits and licenses' }),
    ).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'Doctor dashboard' })).toBeTruthy();
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Data and services' }),
    ).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });
});
