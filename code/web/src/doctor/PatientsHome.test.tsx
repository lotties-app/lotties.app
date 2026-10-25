import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BabyRoutineDb } from '../db/database';
import { testDatabase, type ApiHandler } from '../test/fakeApi';
import { useTestLocale } from '../test/locale';
import { settleSync } from '../test/renderApp';
import { THEME_STORAGE_KEY } from '../theme/themeStorage';
import { patientBaby, patientDto, renderDashboard } from './dashboardTestKit';
import { rememberVisit } from './dashboardStorage';
import { clinicalAge } from './clinicalAge';
import { setUnitSetting } from '../units/state';

/* The doctor's Patients home (docs/design/19-doctor-dashboard.md section 5.1). */

let db: BabyRoutineDb;

const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();
const daysAgo = (days: number) => {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

const LIA = patientBaby('lia', 'Lia', daysAgo(64));
const THEO = patientBaby('theo', 'Theo', daysAgo(200), ['daily_log', 'growth']);
const MAYA = patientBaby('maya', 'Maya', daysAgo(20));
const BIA = patientBaby('bia', 'Bia', daysAgo(400), ['notes', 'vaccines']);

const CARDS = [
  patientDto(LIA, {
    lastEventAt: hoursAgo(3),
    week: {
      from: daysAgo(6),
      to: daysAgo(0),
      sleepMinutesPerDay: 800,
      feedsPerDay: 8.3,
      bottleMlPerDay: 720,
      diapersPerDay: 6.4,
    },
    latestWeight: { weightKg: 5.42, date: '2026-10-21' },
    pendingProposals: 1,
    vaccinesDue: 2,
    sharedNotes: 3,
  }),
  patientDto(THEO, { lastEventAt: hoursAgo(1), latestWeight: null }),
  patientDto(MAYA, { lastEventAt: hoursAgo(24 * 5 + 2), pendingProposals: 2, vaccinesDue: 0 }),
  patientDto(BIA, { vaccinesDue: 0, sharedNotes: 1 }),
];

const handler =
  (cards: unknown = CARDS): ApiHandler =>
  (call) =>
    call.path.startsWith('/api/v1/doctor/patients') ? cards : undefined;

beforeEach(() => {
  db = testDatabase();
  window.localStorage.clear();
});

afterEach(async () => {
  await settleSync();
  await db.delete();
});

const cardNames = () =>
  within(screen.getByRole('list', { name: 'Your patients' }))
    .getAllByRole('heading', { level: 2 })
    .map((heading) => heading.textContent);

const cardOf = (name: string) => screen.getByRole('link', { name }).closest('li') as HTMLElement;

describe('Patients home', () => {
  it('shows each patient with age, last log, the week, the weight and notices', async () => {
    const { calls } = await renderDashboard(db, '/doctor', [LIA, THEO, MAYA, BIA], handler());

    expect(await screen.findByRole('heading', { name: 'Patients', level: 1 })).toBeTruthy();
    expect(screen.getByText('You see only what the family shared.')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('Last log 3 hours ago')).toBeTruthy());
    const lia = cardOf('Lia');
    expect(within(lia).getByText(clinicalAge(LIA.birthDate, new Date(), 'en'))).toBeTruthy();
    expect(within(lia).getByText('Last 7 days, per day')).toBeTruthy();
    expect(within(lia).getByText('13h 20m/day')).toBeTruthy();
    expect(within(lia).getByText('8.3/day')).toBeTruthy();
    expect(within(lia).getByText('720 mL/day')).toBeTruthy();
    expect(within(lia).getByText('6.4/day')).toBeTruthy();
    expect(within(lia).getByText(/^5\.42 kg · /)).toBeTruthy();
    const notices = within(lia).getByRole('list', { name: 'Notices' });
    expect(within(notices).getByText('Your proposal is pending')).toBeTruthy();
    expect(within(notices).getByText('Vaccines due: 2')).toBeTruthy();
    expect(within(cardOf('Maya')).getByText('2 of your proposals are pending')).toBeTruthy();
    expect(calls.some((call) => call.path.includes('timeZone='))).toBe(true);
  });

  it('reads the week and the weight in the own units', async () => {
    setUnitSetting('us');
    await renderDashboard(db, '/doctor', [LIA, THEO, MAYA, BIA], handler());
    await waitFor(() => expect(screen.getByText('Last log 3 hours ago')).toBeTruthy());
    const lia = cardOf('Lia');
    expect(within(lia).getByText('24.3 fl oz/day')).toBeTruthy();
    expect(within(lia).getByText(/^11 lb 15 oz · /)).toBeTruthy();
  });

  it('flags a quiet patient calmly and hides what a family did not share', async () => {
    await renderDashboard(db, '/doctor', [LIA, THEO, MAYA, BIA], handler());

    await waitFor(() => expect(within(cardOf('Maya')).getByText('No logs in 5 days')).toBeTruthy());
    const bia = cardOf('Bia');
    expect(within(bia).getByText('Daily log not shared')).toBeTruthy();
    expect(within(bia).queryByText('Last 7 days, per day')).toBeNull();
    expect(within(bia).queryByText('Weight')).toBeNull();
    expect(within(cardOf('Theo')).getByText('No weight yet')).toBeTruthy();
    expect(within(cardOf('Theo')).queryByRole('list', { name: 'Notices' })).toBeNull();
  });

  it('sorts by recent activity, name or age, and searches by name', async () => {
    await renderDashboard(db, '/doctor', [LIA, THEO, MAYA, BIA], handler());
    await waitFor(() => expect(cardNames()).toEqual(['Theo', 'Lia', 'Maya', 'Bia']));

    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Sort by' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Name' }));
    expect(cardNames()).toEqual(['Bia', 'Lia', 'Maya', 'Theo']);

    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Sort by' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Age' }));
    expect(cardNames()).toEqual(['Maya', 'Lia', 'Theo', 'Bia']);
    expect(window.localStorage.getItem('baby-routine.doctor-dashboard')).toContain('"sort":"age"');

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search patients' }), {
      target: { value: 'th' },
    });
    expect(cardNames()).toEqual(['Theo']);
    expect(screen.getByText('1 patient')).toBeTruthy();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search patients' }), {
      target: { value: 'zz' },
    });
    expect(screen.getByText('No patient matches “zz”.')).toBeTruthy();
  });

  it('opens a patient at the section the doctor last looked at', async () => {
    rememberVisit('theo', 'growth');
    await renderDashboard(db, '/doctor', [LIA, THEO], handler());

    const link = await screen.findByRole('link', { name: 'Theo' });
    expect(link.getAttribute('href')).toBe('/doctor/theo/growth');
    expect(screen.getByRole('link', { name: 'Lia' }).getAttribute('href')).toBe('/doctor/lia');
  });

  it('keeps the device list when the server cannot be reached', async () => {
    await renderDashboard(db, '/doctor', [LIA], () => {
      throw new TypeError('Failed to fetch');
    });

    expect(await screen.findByRole('link', { name: 'Lia' })).toBeTruthy();
    expect(await screen.findByText(/Could not load your patients' numbers/)).toBeTruthy();
  });

  it('explains how an invite works when there is no patient yet', async () => {
    await renderDashboard(db, '/doctor', [], handler([]));

    expect(await screen.findByRole('heading', { name: 'No patients yet' })).toBeTruthy();
    expect(screen.getByText(/they create a doctor invite link, choose what to share/)).toBeTruthy();
  });

  it('reads in pt-BR', async () => {
    await useTestLocale('pt-BR');
    await renderDashboard(db, '/doctor', [LIA, BIA], handler());

    expect(await screen.findByRole('heading', { name: 'Pacientes', level: 1 })).toBeTruthy();
    expect(screen.getByText('Você vê apenas o que a família compartilhou.')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('Diário não compartilhado')).toBeTruthy());
    expect(screen.getByText('Sua proposta está pendente')).toBeTruthy();
    expect(screen.getByText('Vacinas pendentes: 2')).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'Painel do(a) médico(a)' })).toBeTruthy();
  });

  it.each([
    ['light', 'en'],
    ['dark', 'en'],
    ['light', 'pt-BR'],
    ['dark', 'pt-BR'],
  ] as const)(
    'has no accessibility violations (%s, %s)',
    async (scheme, locale) => {
      await useTestLocale(locale);
      window.localStorage.setItem(THEME_STORAGE_KEY, scheme);
      await renderDashboard(db, '/doctor', [LIA, THEO, MAYA, BIA], handler());
      await screen.findAllByRole('heading', { level: 2 });
      const result = await axe.run(document.body, {
        runOnly: ['wcag2a', 'wcag2aa'],
        rules: { 'color-contrast': { enabled: false } },
      });
      expect(result.violations.map((v) => v.id)).toEqual([]);
    },
    60_000,
  );
});
