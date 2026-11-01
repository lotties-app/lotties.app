import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BabyRoutineDb } from '../db/database';
import type { Appointment, BabyRole } from '../db/models';
import { HubPage } from '../pages/HubPage';
import { MEMBERS, proposal, recommendation, seedFamily } from '../proposals/proposalKit';
import { BABY_ID, fakeApi, testDatabase } from '../test/fakeApi';
import { useTestLocale } from '../test/locale';
import { renderWithDb, settleSync } from '../test/renderApp';
import { TEST_SCHEDULE, seedSchedule } from '../test/vaccineSchedule';
import { THEME_STORAGE_KEY } from '../theme/themeStorage';

let db: BabyRoutineDb;

/** Thursday 22 October 2026, 10:00 local: the baby (born 2026-08-01) is 82 days old. */
const NOW = new Date(2026, 9, 22, 10, 0).getTime();
const DAY = 86_400_000;

beforeEach(() => {
  db = testDatabase();
});

afterEach(async () => {
  vi.useRealTimers();
  await settleSync();
  await db.delete();
});

async function renderHub(role: BabyRole = 'Owner', members: unknown[] = MEMBERS) {
  await seedFamily(db, role);
  const fake = fakeApi((call) => (call.path.endsWith('/members') ? members : undefined));
  renderWithDb(db, <HubPage />, { api: fake.api, route: '/hub' });
  await screen.findByRole('heading', { name: /^(Hub|Central)$/, level: 1 });
}

const rows = () =>
  screen.getAllByTestId(/^hub-row-/).map((row) => row.getAttribute('data-testid')!.slice(8));
const shortcuts = () =>
  screen
    .queryAllByTestId(/^hub-shortcut-/)
    .map((tile) => tile.getAttribute('data-testid')!.slice(13));

function appointment(id: string, startsAt: string): Appointment {
  return {
    id,
    babyId: BABY_ID,
    title: id,
    type: 'consultation',
    startsAt,
    durationMinutes: 30,
    location: null,
    doctorName: null,
    notes: null,
    outcome: null,
    status: 'upcoming',
    reminderOffsetsMinutes: [],
    createdBy: 'u1',
    createdAt: startsAt,
    updatedAt: startsAt,
  };
}

describe('the sections', () => {
  it('lists baby care, family and app entries for an Owner, each with its link', async () => {
    await renderHub('Owner');

    expect(screen.getByRole('heading', { name: 'Baby care', level: 2 })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Family', level: 2 })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'App', level: 2 })).toBeTruthy();
    await waitFor(() => expect(rows()).toContain('fromDoctor'));
    expect(rows()).toEqual([
      'appointments',
      'providers',
      'vaccines',
      'growth',
      'medicines',
      'formulas',
      'notes',
      'fromDoctor',
      'members',
      'invite',
      'doctorAccess',
      'settings',
      'import',
      'export',
      'backupImport',
      'install',
      'updates',
      'welcome',
      'about',
      'credits',
      'privacy',
    ]);
    const href = (id: string) => screen.getByTestId(`hub-row-${id}`).getAttribute('href');
    expect(href('appointments')).toBe('/appointments');
    expect(href('growth')).toBe('/insights#growth');
    expect(href('medicines')).toBe('/hub/medicines');
    expect(href('invite')).toBe('/hub/family#invite');
    expect(href('settings')).toBe('/settings');
    expect(href('updates')).toBe('/hub/updates');
    expect(href('install')).toBe('/hub/install');
    expect(href('welcome')).toBe('/welcome');
  });

  it('hides what a Caregiver and a Viewer cannot use', async () => {
    await renderHub('Caregiver', MEMBERS.slice(0, 1));
    expect(rows()).toEqual([
      'appointments',
      'providers',
      'vaccines',
      'growth',
      'medicines',
      'formulas',
      'notes',
      'members',
      'settings',
      'install',
      'updates',
      'welcome',
      'about',
      'credits',
      'privacy',
    ]);
  });

  it('gives a Doctor her patients (her dashboard), never the family records', async () => {
    await renderHub('Doctor', []);
    await screen.findByTestId('hub-row-patients');
    const list = rows();
    expect(list).toContain('patients');
    // A patient's proposals and notes are in the doctor's dashboard, not in the parents' Hub.
    for (const hidden of [
      'appointments',
      'providers',
      'fromDoctor',
      'invite',
      'doctorAccess',
      'import',
      'export',
      'backupImport',
      'myProposals',
      'notes',
      'members',
    ]) {
      expect(list).not.toContain(hidden);
    }
    expect(screen.getByTestId('hub-row-patients').getAttribute('href')).toBe('/doctor');
  });

  it('shows "From your doctor" only when the baby has a doctor or something from one', async () => {
    await renderHub('Owner', MEMBERS.slice(0, 1));
    await screen.findByTestId('hub-row-notes');
    expect(rows()).not.toContain('fromDoctor');
  });

  it('leaves out the update check inside the native app', async () => {
    const globals = globalThis as { Capacitor?: unknown };
    globals.Capacitor = { isNativePlatform: () => true };
    try {
      await renderHub('Owner');
      expect(rows()).not.toContain('updates');
      expect(rows()).toContain('about');
    } finally {
      delete globals.Capacitor;
    }
  });
});

describe('search', () => {
  it('filters the entries by title, hint and keywords, and says how many matched', async () => {
    await renderHub('Owner');
    const box = screen.getByRole('searchbox', { name: 'Search the Hub' });

    fireEvent.change(box, { target: { value: 'vacc' } });
    expect(rows()).toEqual(['vaccines']);
    expect(screen.getByText('1 result')).toBeTruthy();
    // The shortcuts step aside while searching.
    expect(shortcuts()).toEqual([]);

    // A keyword, not in the title.
    fireEvent.change(box, { target: { value: 'shots' } });
    expect(rows()).toEqual(['vaccines']);

    // Sections without a match disappear.
    fireEvent.change(box, { target: { value: 'version' } });
    expect(rows()).toEqual(['updates', 'about']);
    expect(screen.queryByRole('heading', { name: 'Baby care' })).toBeNull();
  });

  it('says so when nothing matches, and the clear button brings everything back', async () => {
    await renderHub('Owner');
    const box = screen.getByRole('searchbox', { name: 'Search the Hub' });
    fireEvent.change(box, { target: { value: 'zzzz' } });
    expect(screen.getByText('Nothing in the Hub matches “zzzz”.')).toBeTruthy();
    expect(screen.queryAllByTestId(/^hub-row-/)).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(rows().length).toBeGreaterThan(5);
    expect(shortcuts()).toHaveLength(4);
  });

  it('ignores accents and case in Portuguese', async () => {
    await useTestLocale('pt-BR');
    await renderHub('Owner');
    const box = screen.getByRole('searchbox', { name: 'Buscar na Central' });
    fireEvent.change(box, { target: { value: 'MEDICO' } });
    expect(rows()).toEqual(expect.arrayContaining(['notes', 'doctorAccess']));
    expect(rows()).not.toContain('vaccines');
  });
});

describe('shortcuts', () => {
  it('start with the usual four and follow what is opened most', async () => {
    await renderHub('Owner');
    expect(shortcuts()).toEqual(['vaccines', 'appointments', 'growth', 'medicines']);

    fireEvent.click(screen.getByTestId('hub-row-notes'));
    fireEvent.click(screen.getByTestId('hub-row-notes'));
    fireEvent.click(screen.getByTestId('hub-row-formulas'));
    await waitFor(() =>
      expect(shortcuts()).toEqual(['notes', 'formulas', 'vaccines', 'appointments']),
    );
    // Remembered on the device.
    expect(JSON.parse(window.localStorage.getItem('lotties.hub.v1')!).counts).toEqual({
      notes: 2,
      formulas: 1,
    });
  });

  it('can be chosen by hand, at most four, and handed back to use', async () => {
    await renderHub('Owner');
    fireEvent.click(screen.getByRole('button', { name: 'Customize' }));
    const dialog = await screen.findByRole('dialog', { name: 'Choose your shortcuts' });
    expect(within(dialog).getByText('4 of 4 chosen')).toBeTruthy();
    // Four are picked: the others are locked until one is dropped.
    expect(
      (within(dialog).getByRole('checkbox', { name: 'Notes' }) as HTMLInputElement).disabled,
    ).toBe(true);
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Vaccines' }));
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Notes' }));
    expect(within(dialog).getByText('4 of 4 chosen')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(shortcuts()).toEqual(['appointments', 'growth', 'medicines', 'notes']);

    // Chosen shortcuts hold, whatever is opened.
    fireEvent.click(screen.getByTestId('hub-row-formulas'));
    fireEvent.click(screen.getByTestId('hub-row-formulas'));
    expect(shortcuts()).toEqual(['appointments', 'growth', 'medicines', 'notes']);

    fireEvent.click(screen.getByRole('button', { name: 'Customize' }));
    fireEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Pick by use' }),
    );
    await waitFor(() => expect(shortcuts()[0]).toBe('formulas'));
  });

  it('never offers the app entries, and drops a chosen shortcut the person can no longer see', async () => {
    window.localStorage.setItem(
      'lotties.hub.v1',
      JSON.stringify({ counts: {}, pinned: ['invite', 'vaccines', 'settings'] }),
    );
    await renderHub('Viewer', MEMBERS.slice(0, 1));
    expect(shortcuts()).toEqual(['vaccines']);
  });

  it('tolerates a damaged stored value', async () => {
    window.localStorage.setItem('lotties.hub.v1', '{"counts":{"nope":3,"notes":"x"},"pinned":7');
    await renderHub('Owner');
    expect(shortcuts()).toEqual(['vaccines', 'appointments', 'growth', 'medicines']);
  });
});

describe('attention badges', () => {
  it('count the vaccines due, the appointments in the next days and the doctor inbox', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    await seedSchedule(db);
    await db.appointments.bulkPut([
      appointment('soon', new Date(NOW + DAY).toISOString()),
      appointment('far', new Date(NOW + 10 * DAY).toISOString()),
    ]);
    await db.proposals.put(proposal('p1'));
    await db.notes.put(recommendation('r1'));
    await renderHub('Owner');

    const badge = (id: string) =>
      within(screen.getByTestId(`hub-row-${id}`)).queryByTestId('hub-badge');
    await waitFor(() => expect(badge('vaccines')?.textContent).toBe('5'));
    expect(badge('appointments')?.textContent).toBe('1');
    expect(badge('fromDoctor')?.textContent).toBe('2');
    expect(badge('notes')?.textContent).toBe('1');
    expect(badge('formulas')).toBeNull();
    // Read aloud as a sentence, and shown on the matching shortcut tile too.
    expect(screen.getByTestId('hub-row-vaccines').textContent).toContain('5 need attention');
    expect(
      within(screen.getByTestId('hub-shortcut-vaccines')).getByTestId('hub-badge').textContent,
    ).toBe('5');
    expect(TEST_SCHEDULE).toBeTruthy();
  });

  it('show nothing when nothing waits', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    await renderHub('Owner', MEMBERS.slice(0, 1));
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(screen.queryAllByTestId('hub-badge')).toHaveLength(0);
  });
});

describe('in Portuguese', () => {
  it('names the sections, entries and shortcuts', async () => {
    await useTestLocale('pt-BR');
    await renderHub('Owner', MEMBERS.slice(0, 1));
    expect(screen.getByRole('heading', { name: 'Cuidados com o bebê', level: 2 })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Família', level: 2 })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Atalhos', level: 2 })).toBeTruthy();
    expect(screen.getByTestId('hub-row-updates').textContent).toContain('Buscar atualizações');
    expect(screen.getByRole('button', { name: 'Personalizar' })).toBeTruthy();
  });
});

describe.each(['light', 'dark'] as const)('accessibility in the %s scheme', (scheme) => {
  it.each(['en', 'pt-BR'] as const)('has no violations in %s', async (locale) => {
    window.localStorage.setItem(THEME_STORAGE_KEY, scheme);
    if (locale === 'pt-BR') await useTestLocale('pt-BR');
    await renderHub('Owner');
    await screen.findByTestId('hub-row-fromDoctor');
    const result = await axe.run(document.body, {
      runOnly: ['wcag2a', 'wcag2aa'],
      rules: { 'color-contrast': { enabled: false } },
    });
    expect(
      result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(' | ')}`),
    ).toEqual([]);
  });
});
