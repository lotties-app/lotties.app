import { fireEvent, screen, within } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BabyRoutineDb } from '../db/database';
import type { Vaccination } from '../db/models';
import { BABY_ID, fakeApi, testDatabase } from '../test/fakeApi';
import { useTestLocale } from '../test/locale';
import { renderWithDb, settleSync } from '../test/renderApp';
import { seedBaby } from '../test/seed';
import { seedSchedule } from '../test/vaccineSchedule';
import { THEME_STORAGE_KEY } from '../theme/themeStorage';
import { PRINT_STYLES, cardRows } from './vaccinationCard';
import { VaccinationCardScreen } from './VaccinationCardScreen';

/*
 * The printable vaccination card (docs/design/18-vaccines.md): the baby, the table of recorded
 * vaccines by date, "Print / Save as PDF" and a print stylesheet. Nothing leaves the device.
 */

let db: BabyRoutineDb;
const BABY = { id: BABY_ID, name: 'Lia', birthDate: '2026-08-01', role: 'Viewer' as const };

function record(id: string, extra: Partial<Vaccination>): Vaccination {
  return {
    id,
    babyId: BABY_ID,
    vaccineKey: null,
    doseId: null,
    customName: null,
    doseLabel: null,
    givenOn: '2026-08-03',
    network: 'public',
    clinic: null,
    lot: null,
    administeredBy: null,
    notes: 'Private note that never goes on the card',
    createdBy: 'u1',
    createdAt: '2026-08-03T12:00:00.000Z',
    updatedAt: '2026-08-03T12:00:00.000Z',
    deletedAt: null,
    ...extra,
  };
}

const RECORDS: Vaccination[] = [
  record('later', {
    vaccineKey: 'penta',
    doseId: 'penta-1',
    givenOn: '2026-10-05',
    lot: 'AB123',
    clinic: 'UBS Centro',
  }),
  record('first', {
    vaccineKey: 'bcg',
    doseId: 'bcg-1',
    givenOn: '2026-08-03',
    clinic: 'Maternidade',
    network: 'private',
  }),
  record('custom', { customName: 'Travel vaccine', doseLabel: 'Booster', givenOn: '2026-09-10' }),
  record('gone', {
    vaccineKey: 'vip',
    doseId: 'vip-1',
    givenOn: '2026-10-06',
    deletedAt: '2026-10-07T00:00:00.000Z',
  }),
  record('retired', {
    vaccineKey: 'hepatite-b',
    doseId: 'hepatite-b-retired',
    doseLabel: 'Old birth dose',
    givenOn: '2026-08-04',
  }),
];

beforeEach(async () => {
  db = testDatabase();
  await seedBaby(db, { role: 'Viewer' });
  await seedSchedule(db);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await settleSync();
  await db.delete();
});

async function renderCard(records: Vaccination[] = RECORDS) {
  await db.vaccinations.bulkPut(records);
  const fake = fakeApi();
  renderWithDb(db, <VaccinationCardScreen baby={BABY} now={new Date(2026, 9, 22)} />, {
    api: fake.api,
  });
  return { ...fake, heading: await screen.findByRole('heading', { level: 1 }) };
}

describe('the vaccination card', () => {
  it('shows the baby and a table of the recorded vaccines by date', async () => {
    await renderCard();

    expect(screen.getByRole('heading', { name: 'Vaccination card', level: 1 })).toBeTruthy();
    expect(screen.getAllByText('Lia').length).toBeGreaterThan(0);
    expect(screen.getByText(/^Born .*2026$/)).toBeTruthy();
    const table = screen.getByRole('table', { name: 'Vaccines recorded for Lia' });
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((header) => header.textContent),
    ).toEqual(['Date', 'Vaccine', 'Dose', 'Lot', 'Clinic']);
    const rows = within(table).getAllByRole('row').slice(1);
    expect(
      rows.map((row) =>
        within(row)
          .getAllByRole('cell')
          .map((cell) => cell.textContent),
      ),
    ).toEqual([
      [expect.stringMatching(/2026/), 'BCG', 'Single dose', '', 'Maternidade · Private clinic'],
      [expect.stringMatching(/2026/), 'Hepatitis B', 'Old birth dose', '', 'Public (SUS)'],
      [expect.stringMatching(/2026/), 'Travel vaccine', 'Booster', '', 'Public (SUS)'],
      [
        expect.stringMatching(/2026/),
        'Pentavalent',
        '1st dose',
        'AB123',
        'UBS Centro · Public (SUS)',
      ],
    ]);
  });

  it('leaves deleted records and private notes off the card', async () => {
    await renderCard();
    expect(screen.queryByText('Inactivated polio (IPV)')).toBeNull();
    expect(screen.queryByText(/Private note/)).toBeNull();
  });

  it('says so when nothing is recorded', async () => {
    await renderCard([]);
    expect(screen.getByText('No vaccines recorded yet.')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('prints through the browser and sends nothing anywhere', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    const { calls } = await renderCard();

    fireEvent.click(screen.getByRole('button', { name: 'Print / Save as PDF' }));

    expect(print).toHaveBeenCalledTimes(1);
    expect(calls).toEqual([]);
    expect(screen.getByRole('link', { name: 'Back to vaccines' }).getAttribute('href')).toBe(
      '/vaccines',
    );
  });

  it('has a print stylesheet that hides the app and rules the table in black on white', async () => {
    await renderCard();

    const css = [...document.querySelectorAll('style')]
      .map((style) => style.textContent)
      .join('\n');
    expect(css).toContain('@media print');
    expect(css).toMatch(/\.vaccination-card table/);
    const printed = PRINT_STYLES['@media print'];
    expect(Object.keys(printed).join(' ')).toMatch(/header, nav/);
    expect(printed['header, nav, .MuiFab-root, .MuiSnackbar-root, [data-print-hide]']).toEqual({
      display: 'none !important',
    });
    expect(printed['.vaccination-card th, .vaccination-card td'].border).toBe('1px solid #000');
    // The page's own buttons are marked so the stylesheet hides them.
    expect(
      screen.getByRole('button', { name: 'Print / Save as PDF' }).closest('[data-print-hide]'),
    ).not.toBeNull();
  });

  it('sorts rows by the date given, oldest first, then by when they were recorded', () => {
    const a = record('a', { givenOn: '2026-09-01', createdAt: '2026-09-02T00:00:00.000Z' });
    const b = record('b', { givenOn: '2026-09-01', createdAt: '2026-09-01T00:00:00.000Z' });
    const c = record('c', { givenOn: '2026-08-01' });
    expect(cardRows([a, b, c]).map((r) => r.id)).toEqual(['c', 'b', 'a']);
  });

  it('is in Portuguese for a Portuguese user', async () => {
    await useTestLocale('pt-BR');
    await renderCard();

    expect(screen.getByRole('heading', { name: 'Caderneta de vacinação', level: 1 })).toBeTruthy();
    expect(
      within(screen.getByRole('table'))
        .getAllByRole('columnheader')
        .map((header) => header.textContent),
    ).toEqual(['Data', 'Vacina', 'Dose', 'Lote', 'Local']);
    expect(screen.getByRole('button', { name: 'Imprimir / Salvar como PDF' })).toBeTruthy();
  });
});

describe.each(['light', 'dark'] as const)('the card in the %s scheme', (scheme) => {
  it.each(['en', 'pt-BR'] as const)(
    'has no accessibility violations in %s',
    async (locale) => {
      window.localStorage.setItem(THEME_STORAGE_KEY, scheme);
      if (locale === 'pt-BR') await useTestLocale('pt-BR');
      await renderCard();

      const result = await axe.run(document.body, {
        runOnly: ['wcag2a', 'wcag2aa'],
        rules: { 'color-contrast': { enabled: false } },
      });
      expect(result.violations.map((v) => v.id)).toEqual([]);
    },
    60_000,
  );
});
