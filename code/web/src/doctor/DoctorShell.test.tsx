import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import axe from 'axe-core';
import { Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BabyRoutineDb } from '../db/database';
import type { Baby } from '../db/models';
import { UserMenu } from '../layout/UserMenu';
import { HomePage } from '../pages/HomePage';
import { SLEEP_DTO } from '../test/builtInTypes';
import { fakeApi, testDatabase, type ApiHandler } from '../test/fakeApi';
import { renderWithDb, settleSync } from '../test/renderApp';
import { THEME_STORAGE_KEY } from '../theme/themeStorage';
import { readDashboardState, writeAppMode, writePatientSort } from './dashboardStorage';
import { LocationProbe } from '../test/LocationProbe';
import { patientBaby, patientDto, renderDashboard } from './dashboardTestKit';

/*
 * The doctor's shell (docs/design/19-doctor-dashboard.md sections 3 and 6): its own navigation, the
 * patient switcher (search, recents, arrows, `[` / `]`, the URL and the section kept), the landing
 * and the "My babies" / "My patients" switch.
 */

let db: BabyRoutineDb;

const ANA = patientBaby('ana', 'Ana', '2026-02-01');
const LIA = patientBaby('lia', 'Lia', '2026-08-01');
const THEO = patientBaby('theo', 'Theo', '2026-04-01', ['daily_log', 'growth']);
const MINE: Baby = {
  id: 'mine',
  name: 'Nina',
  birthDate: '2026-09-01',
  role: 'Owner',
  userId: 'doc',
};

const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();

/** Server cards: Lia logged most recently, then Ana, then Theo. */
const handler: ApiHandler = (call) => {
  const path = call.path.split('?')[0];
  if (path === '/api/v1/doctor/patients') {
    return [
      patientDto(ANA, { lastEventAt: hoursAgo(5) }),
      patientDto(LIA, { lastEventAt: hoursAgo(1) }),
      patientDto(THEO, { lastEventAt: hoursAgo(9) }),
    ];
  }
  if (path.endsWith('/event-types')) return [SLEEP_DTO];
  return undefined;
};

beforeEach(() => {
  db = testDatabase();
  window.localStorage.clear();
});

afterEach(async () => {
  await settleSync();
  await db.delete();
});

const location = () => screen.getByTestId('location').textContent;
const nav = () => screen.getByRole('navigation', { name: 'Doctor dashboard' });

async function switcherReady() {
  // The order comes from the server's cards (latest activity first): Lia, Ana, Theo.
  await screen.findByRole('button', { name: /^Next patient: / }, { timeout: 5000 });
}

describe('the doctor navigation', () => {
  it('offers Patients and the sections of the last patient opened', async () => {
    await renderDashboard(db, '/doctor', [LIA, THEO], handler);

    await screen.findByRole('heading', { name: 'Patients', level: 1 });
    const links = within(nav());
    expect(links.getByRole('link', { name: 'Patients' }).getAttribute('aria-current')).toBe('page');
    // No patient opened yet: the sections cannot be followed.
    expect(
      links
        .getByRole('link', { name: 'Summary. Open a patient first' })
        .getAttribute('aria-disabled'),
    ).toBe('true');
    expect(screen.queryByRole('button', { name: 'Add event' })).toBeNull();
  });

  it('keeps the patient in every section link and marks the current one', async () => {
    await renderDashboard(db, '/doctor/theo/growth', [LIA, THEO], handler);

    await screen.findByRole('heading', { name: 'Growth', level: 1 });
    const links = within(nav());
    expect(links.getByRole('link', { name: 'Growth' }).getAttribute('aria-current')).toBe('page');
    expect(links.getByRole('link', { name: 'Timeline' }).getAttribute('href')).toBe(
      '/doctor/theo/timeline',
    );
    expect(links.getByRole('link', { name: 'Summary' }).getAttribute('href')).toBe('/doctor/theo');
    expect(readDashboardState()).toMatchObject({
      lastPatient: 'theo',
      sections: { theo: 'growth' },
      recents: ['theo'],
    });
  });

  it('says a section is not shared, and lets an unknown patient go back', async () => {
    await renderDashboard(db, '/doctor/theo/notes', [THEO], handler);

    expect(await screen.findByRole('heading', { name: 'Notes', level: 1 })).toBeTruthy();
    expect(screen.getByText('Not shared with you')).toBeTruthy();
    expect(screen.getByText(/The family did not share notes/)).toBeTruthy();
  });

  it('answers a patient the doctor no longer follows', async () => {
    await renderDashboard(db, '/doctor/gone', [LIA], handler);

    expect(await screen.findByText(/This baby is not on your patient list/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Back to patients' }).getAttribute('href')).toBe(
      '/doctor',
    );
  });
});

describe('the patient switcher', () => {
  it('names the patient and moves to the previous and next one in the same section', async () => {
    await renderDashboard(db, '/doctor/ana/growth', [ANA, LIA, THEO], handler);
    await switcherReady();

    expect(screen.getByRole('button', { name: /^Ana, .*\. Change patient$/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Next patient: Theo' }));
    await waitFor(() => expect(location()).toBe('/doctor/theo/growth'));
    fireEvent.click(await screen.findByRole('button', { name: 'Next patient: Lia' }));
    await waitFor(() => expect(location()).toBe('/doctor/lia/growth'));
    fireEvent.click(await screen.findByRole('button', { name: 'Previous patient: Theo' }));
    await waitFor(() => expect(location()).toBe('/doctor/theo/growth'));
  });

  it('follows the Patients sort', async () => {
    writePatientSort('name');
    await renderDashboard(db, '/doctor/ana', [ANA, LIA, THEO], handler);
    await switcherReady();

    expect(screen.getByRole('button', { name: 'Next patient: Lia' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Previous patient: Theo' })).toBeTruthy();
  });

  it('moves with the [ and ] keys, but not while typing', async () => {
    await renderDashboard(db, '/doctor/lia/timeline', [ANA, LIA, THEO], handler);
    await switcherReady();

    fireEvent.keyDown(window, { key: ']' });
    await waitFor(() => expect(location()).toBe('/doctor/ana/timeline'));
    fireEvent.keyDown(window, { key: '[' });
    await waitFor(() => expect(location()).toBe('/doctor/lia/timeline'));

    const input = document.createElement('input');
    document.body.append(input);
    fireEvent.keyDown(input, { key: ']' });
    expect(location()).toBe('/doctor/lia/timeline');
    input.remove();
  });

  it('searches, lists the recent patients and picks one with the keyboard', async () => {
    await renderDashboard(db, '/doctor/theo/growth', [ANA, LIA, THEO], handler);
    await switcherReady();

    fireEvent.click(screen.getByRole('button', { name: /^Theo, .*\. Change patient$/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Change patient' });
    const input = within(dialog).getByRole('combobox', { name: 'Search patients' });
    await waitFor(() => expect(document.activeElement).toBe(input));
    expect(within(dialog).getByRole('group', { name: 'Recently opened' })).toBeTruthy();
    const all = within(dialog).getByRole('group', { name: 'All patients' });
    expect(
      within(all)
        .getAllByRole('option')
        .map((o) => o.textContent?.match(/Lia|Ana|Theo/)?.[0]),
    ).toEqual(['Lia', 'Ana', 'Theo']);

    fireEvent.change(input, { target: { value: 'an' } });
    const options = within(dialog).getAllByRole('option');
    expect(options.map((o) => o.textContent?.match(/Lia|Ana|Theo/)?.[0])).toEqual(['Ana']);
    expect(input.getAttribute('aria-activedescendant')).toBe(options[0].id);
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(location()).toBe('/doctor/ana/growth'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('moves the active option with the arrows', async () => {
    await renderDashboard(db, '/doctor/lia', [ANA, LIA, THEO], handler);
    await switcherReady();

    fireEvent.click(screen.getByRole('button', { name: /^Lia, .*\. Change patient$/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Change patient' });
    const input = within(dialog).getByRole('combobox', { name: 'Search patients' });
    const options = within(dialog).getAllByRole('option');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input.getAttribute('aria-activedescendant')).toBe(options[1].id);
    expect(options[1].getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(input.getAttribute('aria-activedescendant')).toBe(options[options.length - 1].id);
  });

  it.each(['light', 'dark'] as const)(
    'has no accessibility violations with the switcher open (%s)',
    async (scheme) => {
      window.localStorage.setItem(THEME_STORAGE_KEY, scheme);
      await renderDashboard(db, '/doctor/lia', [ANA, LIA, THEO], handler);
      await switcherReady();
      fireEvent.click(screen.getByRole('button', { name: /^Lia, .*\. Change patient$/ }));
      await screen.findByRole('dialog', { name: 'Change patient' });
      const result = await axe.run(document.body, {
        runOnly: ['wcag2a', 'wcag2aa'],
        rules: { 'color-contrast': { enabled: false } },
      });
      expect(result.violations.map((v) => v.id)).toEqual([]);
    },
    60_000,
  );
});

describe('landing and the mode switch', () => {
  function renderHome(babies: Baby[]) {
    return db.babies.bulkPut(babies).then(() =>
      renderWithDb(
        db,
        <>
          <Routes>
            <Route
              path="/"
              element={
                <>
                  <UserMenu />
                  <HomePage />
                </>
              }
            />
            <Route
              path="/doctor"
              element={
                <>
                  <UserMenu />
                  <p>DASHBOARD</p>
                </>
              }
            />
          </Routes>
          <LocationProbe />
        </>,
        { api: fakeApi().api },
      ),
    );
  }

  it('sends a doctor without a baby of her own to the dashboard', async () => {
    await renderHome([LIA]);

    expect(await screen.findByText('DASHBOARD')).toBeTruthy();
  });

  it('lets a parent who is also a doctor switch and remembers the choice', async () => {
    writeAppMode('babies');
    await renderHome([MINE, LIA]);
    await waitFor(() => expect(location()).toBe('/'));

    fireEvent.click(screen.getByRole('button', { name: 'User menu' }));
    const menu = await screen.findByRole('menu');
    const babies = await within(menu).findByRole('menuitemradio', { name: 'My babies' });
    expect(babies.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(within(menu).getByRole('menuitemradio', { name: 'My patients' }));

    expect(await screen.findByText('DASHBOARD')).toBeTruthy();
    expect(readDashboardState().mode).toBe('patients');
  });

  it('opens the dashboard on the next visit after "My patients"', async () => {
    writeAppMode('patients');
    await renderHome([MINE, LIA]);

    expect(await screen.findByText('DASHBOARD')).toBeTruthy();
  });

  it('offers no switch to a user with only her own babies', async () => {
    await renderHome([MINE]);
    await waitFor(() => expect(location()).toBe('/'));

    fireEvent.click(screen.getByRole('button', { name: 'User menu' }));
    const menu = await screen.findByRole('menu');
    // The babies are known once the baby profile entry is there.
    await within(menu).findByRole('menuitem', { name: 'Baby profile' });
    expect(within(menu).queryByRole('menuitemradio')).toBeNull();
  });
});

describe('the doctor settings', () => {
  it('show her account settings only, never a baby of the family', async () => {
    await renderDashboard(db, '/doctor/settings', [MINE, LIA], handler);

    expect(await screen.findByRole('heading', { name: 'Settings', level: 1 })).toBeTruthy();
    expect(screen.getByRole('button', { name: "I'm a healthcare professional" })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Members & invites' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Medications' })).toBeNull();
  });

  it('let a doctor-only user download her own data and delete her account (store rule)', async () => {
    const { calls } = await renderDashboard(db, '/doctor/settings#account', [LIA], (call) =>
      call.path === '/api/v1/me/deletion-preview'
        ? {
            deletedBabies: [],
            sharedBabies: [{ id: LIA.id, name: LIA.name }],
            blockedBabies: [],
            canDelete: true,
            identityRemovable: false,
          }
        : handler(call),
    );

    expect(await screen.findByRole('button', { name: 'Account and data' })).toBeTruthy();
    expect(screen.getByText(/Your patients' records are not included/)).toBeTruthy();
    expect(screen.getByRole('link', { name: /Privacy policy/ }).getAttribute('href')).toBe(
      '/doctor/privacy',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Delete my account…' }));
    expect(await screen.findByText(/You will leave these babies/)).toBeTruthy();
    expect(screen.getByText(/This server does not delete your sign-in account/)).toBeTruthy();
    expect(calls.some((call) => call.method === 'DELETE')).toBe(false);
  });
});
