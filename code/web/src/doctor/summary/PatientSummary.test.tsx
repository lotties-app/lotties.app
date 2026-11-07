import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BabyRoutineDb } from '../../db/database';
import type { Note } from '../../db/models';
import { TEMPERATURE_DTO } from '../../test/builtInTypes';
import { testDatabase, type ApiCall, type ApiHandler } from '../../test/fakeApi';
import { useTestLocale } from '../../test/locale';
import { settleSync } from '../../test/renderApp';
import { THEME_STORAGE_KEY } from '../../theme/themeStorage';
import { lastQuery, patientBaby, renderDashboard, summaryDto } from '../dashboardTestKit';
import type { DoctorScope } from '../scopes';
import { lastDays } from './summaryRange';

/* The patient summary (docs/design/19-doctor-dashboard.md section 5.2). */

let db: BabyRoutineDb;

const LIA = patientBaby('lia', 'Lia', '2026-08-01');
const THEO = patientBaby('theo', 'Theo', '2026-04-01', ['daily_log', 'growth']);

const TEMPERATURE = { ...TEMPERATURE_DTO, id: 'type-temperature' };

function handler(
  scopes: readonly DoctorScope[] | undefined = undefined,
  extra: (call: ApiCall) => unknown = () => undefined,
): ApiHandler {
  return (call) => {
    const path = call.path.split('?')[0];
    if (path.endsWith('/clinical-summary')) {
      const query = new URL(call.path, 'http://test').searchParams;
      const babyId = path.split('/')[4];
      const range = { from: query.get('from') ?? '', to: query.get('to') ?? '' };
      return summaryDto(babyId, range, scopes);
    }
    if (path.endsWith('/event-types')) return [TEMPERATURE];
    return extra(call);
  };
}

beforeEach(() => {
  db = testDatabase();
  window.localStorage.clear();
});

afterEach(async () => {
  await settleSync();
  await db.delete();
});

const section = (name: string) => screen.getByRole('region', { name });

describe('patient summary', () => {
  it('shows every shared section with its numbers and how each is computed', async () => {
    const { calls } = await renderDashboard(db, '/doctor/lia', [LIA], handler());

    expect(await screen.findByRole('heading', { name: 'Summary', level: 1 })).toBeTruthy();
    await screen.findByRole('region', { name: 'Sleep' });
    const sleep = section('Sleep');
    expect(within(sleep).getByText('14h 05m')).toBeTruthy();
    expect(within(sleep).getByText('10h')).toBeTruthy();
    expect(within(sleep).getByText('3.2 · 4h 05m')).toBeTruthy();
    expect(within(sleep).getByText('20:30')).toBeTruthy();
    expect(within(sleep).getByText('06:15')).toBeTruthy();
    expect(within(sleep).getByText('Averages over 6 days with data')).toBeTruthy();
    expect(
      within(sleep).getByRole('button', { name: 'How Total per day is computed' }),
    ).toBeTruthy();
    expect(within(sleep).getByRole('img', { name: /Sleep per day/ })).toBeTruthy();

    const feeding = section('Feeding');
    expect(within(feeding).getByText('8.1')).toBeTruthy();
    expect(within(feeding).getByText('2h 52m')).toBeTruthy();
    expect(within(feeding).getByText('Aptamil 1')).toBeTruthy();
    expect(within(feeding).getByText('28 bottles · 3,360 mL')).toBeTruthy();
    // '7' is also a chart tick on the 7th of the month, so more than one match is fine.
    expect(within(section('Diapers')).getAllByText('7').length).toBeGreaterThan(0);
    const symptoms = section('Symptoms and temperatures');
    expect(await within(symptoms).findByText(/37[.,]8/)).toBeTruthy();
    const meds = section('Medications');
    expect(within(meds).getByText('Vitamin D')).toBeTruthy();
    expect(within(meds).getByText('6 doses')).toBeTruthy();
    const vaccines = section('Vaccines');
    expect(within(vaccines).getByText('Pentavalent')).toBeTruthy();
    expect(within(vaccines).getByText(/^Overdue since /)).toBeTruthy();
    expect(within(section('Growth')).getByText(/^5\.42 kg · /)).toBeTruthy();
    expect(
      within(section('Growth')).getByText('Percentile curves are not shown yet.'),
    ).toBeTruthy();
    expect(within(section('Formulas')).getByText('Aptamil 1 · Danone')).toBeTruthy();
    expect(within(section('Notes')).getByText('No notes of yours in this period.')).toBeTruthy();
    expect(screen.queryByText('Not shared with you')).toBeNull();

    const query = lastQuery(calls, '/clinical-summary');
    expect({ from: query.get('from'), to: query.get('to') }).toEqual(lastDays(new Date(), 7));
    expect(query.get('timeZone')).toBeTruthy();
  });

  it('says which sections the family did not share', async () => {
    await renderDashboard(db, '/doctor/theo', [THEO], handler(['daily_log', 'growth']));

    await screen.findByRole('region', { name: 'Sleep' });
    for (const name of ['Medications', 'Vaccines', 'Notes', 'Formulas']) {
      expect(within(section(name)).getByText('Not shared with you')).toBeTruthy();
    }
    expect(within(section('Growth')).queryByText('Not shared with you')).toBeNull();
    expect(
      (screen.getByRole('button', { name: 'Since last note' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('says when a shared section has no data in the period', async () => {
    await renderDashboard(db, '/doctor/lia', [LIA], (call) => {
      const path = call.path.split('?')[0];
      if (!path.endsWith('/clinical-summary')) return undefined;
      const query = new URL(call.path, 'http://test').searchParams;
      const full = summaryDto('lia', { from: query.get('from')!, to: query.get('to')! });
      return {
        ...full,
        sleep: { ...full.sleep!, days: full.sleep!.days.map((d) => ({ ...d, totalMinutes: 0 })) },
        symptoms: { items: [] },
        growth: { measurements: [] },
      };
    });

    await screen.findByRole('region', { name: 'Sleep' });
    expect(within(section('Sleep')).getByText('No data in this period.')).toBeTruthy();
    expect(
      within(section('Symptoms and temperatures')).getByText('No data in this period.'),
    ).toBeTruthy();
    expect(within(section('Growth')).getByText('No data in this period.')).toBeTruthy();
  });

  it('changes the period from the chips and keeps it in the URL', async () => {
    const { calls } = await renderDashboard(db, '/doctor/lia', [LIA], handler());
    await screen.findByRole('region', { name: 'Sleep' });

    fireEvent.click(screen.getByRole('button', { name: '14 days' }));

    await waitFor(() =>
      expect(lastQuery(calls, '/clinical-summary').get('from')).toBe(lastDays(new Date(), 14).from),
    );
    expect(screen.getByTestId('location').textContent).toBe('/doctor/lia?range=last14');
    expect(screen.getByRole('button', { name: '14 days' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
  });

  it('starts a period on the day of her latest note', async () => {
    const written = new Date();
    written.setDate(written.getDate() - 10);
    const note: Note = {
      id: 'n1',
      babyId: 'lia',
      authorUserId: 'doc',
      author: null,
      kind: 'note',
      visibility: 'private',
      body: 'Check the weight again.',
      createdAt: written.toISOString(),
      updatedAt: written.toISOString(),
      deletedAt: null,
    };
    await db.notes.put(note);
    const { calls } = await renderDashboard(db, '/doctor/lia?range=sinceNote', [LIA], handler());

    await screen.findByRole('region', { name: 'Notes' });
    // The period follows the note once the device's notes are read.
    await waitFor(() =>
      expect(lastQuery(calls, '/clinical-summary').get('from')).toBe(lastDays(new Date(), 11).from),
    );
    expect(await within(section('Notes')).findByText('Check the weight again.')).toBeTruthy();
  });

  it('lets the doctor stop following the patient, who leaves the device', async () => {
    const { calls } = await renderDashboard(db, '/doctor/lia', [LIA], handler());
    await screen.findByRole('region', { name: 'Sleep' });

    fireEvent.click(screen.getByRole('button', { name: 'Stop following Lia' }));
    const dialog = await screen.findByRole('dialog', { name: 'Stop following Lia?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Stop following' }));

    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/doctor'));
    expect(
      calls.some(
        (call) => call.method === 'DELETE' && call.path === '/api/v1/babies/lia/members/me',
      ),
    ).toBe(true);
    expect(await db.babies.get('lia')).toBeUndefined();
  });

  it('refuses a custom period longer than 92 days', async () => {
    await renderDashboard(db, '/doctor/lia', [LIA], handler());
    await screen.findByRole('region', { name: 'Sleep' });

    fireEvent.click(screen.getByRole('button', { name: 'Custom' }));
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-01-01' } });
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-10-01' } });

    expect(screen.getByText('Choose a start on or before the end, at most 92 days.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Apply' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('reads in pt-BR', async () => {
    await useTestLocale('pt-BR');
    await renderDashboard(db, '/doctor/theo', [THEO], handler(['daily_log', 'growth']));

    expect(await screen.findByRole('heading', { name: 'Resumo', level: 1 })).toBeTruthy();
    expect(await screen.findByRole('region', { name: 'Sono' })).toBeTruthy();
    expect(screen.getAllByText('Não compartilhado com você').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Últimos 7 dias' })).toBeTruthy();
  });

  it.each([
    ['light', 'en'],
    ['dark', 'pt-BR'],
  ] as const)(
    'has no accessibility violations (%s, %s)',
    async (scheme, locale) => {
      await useTestLocale(locale);
      window.localStorage.setItem(THEME_STORAGE_KEY, scheme);
      await renderDashboard(db, '/doctor/theo', [THEO], handler(['daily_log', 'growth']));
      await screen.findAllByRole('region');
      const result = await axe.run(document.body, {
        runOnly: ['wcag2a', 'wcag2aa'],
        rules: { 'color-contrast': { enabled: false } },
      });
      expect(result.violations.map((v) => v.id)).toEqual([]);
    },
    60_000,
  );
});
