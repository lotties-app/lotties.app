import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppRoutes } from '../AppRoutes';
import type { BabyRoutineDb } from '../db/database';
import type { Baby } from '../db/models';
import { patientBaby, patientDto, renderDashboard } from '../doctor/dashboardTestKit';
import { HubPage } from '../pages/HubPage';
import { seedFamily } from '../proposals/proposalKit';
import { DeleteAccountSection } from '../settings/DeleteAccountSection';
import { VoiceAssistantsSection } from '../settings/VoiceAssistantsSection';
import { fakeApi, testDatabase } from '../test/fakeApi';
import { renderWithDb, settleSync } from '../test/renderApp';
import { seedBaby } from '../test/seed';

/* The privacy policy inside the signed-in app: the Hub entry and page, About, Settings and the doctor's shell. */

let db: BabyRoutineDb;

beforeEach(() => {
  db = testDatabase();
  window.localStorage.clear();
});

afterEach(async () => {
  await settleSync();
  await db.delete();
});

describe('Hub > App > Privacy policy', () => {
  it.each(['Owner', 'Viewer', 'Caregiver'] as const)(
    'is listed for a %s and opens the policy inside the shell',
    async (role) => {
      await seedFamily(db, role);
      renderWithDb(db, <AppRoutes />, { route: '/hub' });
      const row = await screen.findByTestId('hub-row-privacy');
      expect(row.getAttribute('href')).toBe('/hub/privacy');
      expect(row.textContent).toContain('Privacy policy');
      fireEvent.click(row);
      expect(await screen.findByRole('heading', { level: 1, name: 'Privacy policy' })).toBeTruthy();
      // The app shell is still around the page, and a way back to the Hub.
      expect(screen.getByRole('link', { name: 'Back to Hub' })).toBeTruthy();
      expect(
        await screen.findByRole('heading', { level: 2, name: 'What we collect and why' }),
      ).toBeTruthy();
      expect(screen.getByRole('table', { name: 'Information Lotties handles' })).toBeTruthy();
    },
  );

  it('is found by searching the Hub', async () => {
    await seedFamily(db, 'Owner');
    renderWithDb(db, <HubPage />, { api: fakeApi().api, route: '/hub' });
    fireEvent.change(await screen.findByRole('searchbox'), { target: { value: 'lgpd' } });
    expect(screen.getAllByTestId(/^hub-row-/).map((r) => r.getAttribute('data-testid'))).toEqual([
      'hub-row-privacy',
    ]);
  });

  it('is linked from About', async () => {
    await seedBaby(db);
    renderWithDb(db, <AppRoutes />, { route: '/hub/about' });
    const link = await screen.findByRole('link', { name: 'Privacy policy' });
    expect(link.getAttribute('href')).toBe('/hub/privacy');
  });

  it('opens at the section a link names', async () => {
    await seedBaby(db);
    renderWithDb(db, <AppRoutes />, { route: '/hub/privacy#privacy-sharing-companies' });
    const heading = await screen.findByRole('heading', {
      level: 3,
      name: 'Companies and services that receive data',
    });
    expect(heading.id).toBe('privacy-sharing-companies');
  });
});

describe('links from Settings', () => {
  it('Account and data links the policy next to the download and the deletion', async () => {
    renderWithDb(db, <DeleteAccountSection />, { api: fakeApi().api });
    const link = screen.getByRole('link', {
      name: 'Privacy policy: what we keep, for how long, and your rights',
    });
    expect(link.getAttribute('href')).toBe('/hub/privacy');
    expect(screen.getByRole('button', { name: 'Download my data' })).toBeTruthy();
  });

  it('Voice assistants say what Amazon gets and link the policy', async () => {
    const babies: Baby[] = [{ id: 'b1', name: 'Lia', birthDate: '2026-08-01', role: 'Owner' }];
    const { api } = fakeApi((call) =>
      call.path === '/api/v1/me/assistant-settings'
        ? { defaultBabyId: null, updatedAt: null }
        : undefined,
    );
    renderWithDb(db, <VoiceAssistantsSection babies={babies} />, { api });
    expect(await screen.findByText(/Amazon processes what you say to Alexa/)).toBeTruthy();
    const link = screen.getByRole('link', { name: /privacy policy/ });
    expect(link.getAttribute('href')).toBe('/hub/privacy#privacy-sharing-companies');
  });
});

describe("the doctor's shell", () => {
  const LIA = patientBaby('lia', 'Lia', '2026-08-01');

  it('opens the policy at /doctor/privacy inside her own navigation', async () => {
    await renderDashboard(db, '/doctor/privacy', [LIA], (call) =>
      call.path.split('?')[0] === '/api/v1/doctor/patients' ? [patientDto(LIA)] : undefined,
    );
    expect(await screen.findByRole('heading', { level: 1, name: 'Privacy policy' })).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'Doctor dashboard' })).toBeTruthy();
    expect(await screen.findByRole('heading', { level: 2, name: 'Children' })).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });

  it('links it from her account menu', async () => {
    await renderDashboard(db, '/doctor', [LIA], (call) =>
      call.path.split('?')[0] === '/api/v1/doctor/patients' ? [patientDto(LIA)] : undefined,
    );
    fireEvent.click(await screen.findByRole('button', { name: /User menu|Menu do usuário/ }));
    const item = await screen.findByRole('menuitem', { name: 'Privacy policy' });
    expect(item.getAttribute('href')).toBe('/doctor/privacy');
  });
});
