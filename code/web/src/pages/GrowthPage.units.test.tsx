import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BabyRoutineDb } from '../db/database';
import { activateLocale } from '../i18n/i18n';
import type { MeasurementDto } from '../sync/contract';
import { BABY_ID, fakeApi, testDatabase } from '../test/fakeApi';
import { useTestLocale } from '../test/locale';
import { renderWithDb, settleSync } from '../test/renderApp';
import { seedBaby } from '../test/seed';
import { setUnitSetting } from '../units/state';
import { GrowthPage } from './GrowthPage';

/*
 * Growth in US customary units (docs/design/37a-measurement-units-web.md): weight as pounds and
 * ounces, lengths in inches; the stored values stay kg and cm, and an edit nobody touched sends
 * them back unchanged.
 */

let db: BabyRoutineDb;

beforeEach(() => {
  setUnitSetting('us');
  db = testDatabase();
});

afterEach(async () => {
  await settleSync();
  setUnitSetting('auto');
  await activateLocale('en');
  vi.restoreAllMocks();
  await db.delete();
});

const BASE = `/api/v1/babies/${BABY_ID}/measurements`;

function measurement(id: string, date: string, overrides: Partial<MeasurementDto>) {
  return {
    id,
    babyId: BABY_ID,
    date,
    weightKg: null,
    heightCm: null,
    headCircumferenceCm: null,
    notes: null,
    createdBy: 'u1',
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...overrides,
  } satisfies MeasurementDto;
}

const SERVER = [
  measurement('m-new', '2026-10-10', { weightKg: 3.5, heightCm: 50, headCircumferenceCm: 33.5 }),
];

async function setup() {
  await seedBaby(db, { role: 'Parent' });
  const fake = fakeApi((call) =>
    call.method === 'GET' && call.path === BASE ? SERVER : undefined,
  );
  renderWithDb(db, <GrowthPage />, { api: fake.api });
  await screen.findByRole('list', { name: /Measurements|Medidas/ });
  return fake;
}

describe('GrowthPage in US units', () => {
  it('lists values in pounds, ounces and inches and draws the charts in them', async () => {
    await setup();
    const item = within(await screen.findByRole('list', { name: 'Measurements' })).getAllByRole(
      'listitem',
    )[0];
    expect(item.textContent).toContain('Weight 7 lb 11 oz');
    expect(item.textContent).toContain('Height 19.7 in');
    expect(item.textContent).toContain('Head circumference 13.2 in');
    const charts = screen.getAllByRole('img');
    expect(charts[0].getAttribute('aria-label')).toContain('7 lb 11 oz');
    expect(screen.getByText('Weight (lb)')).toBeTruthy();
  });

  it('adds a weight typed as pounds and ounces as 3.487 kg and a length as cm', async () => {
    const { writes } = await setup();
    fireEvent.click(await screen.findByRole('button', { name: 'Add measurement' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Weight (lb)'), { target: { value: '7' } });
    fireEvent.change(within(dialog).getByLabelText('Weight (oz)'), { target: { value: '11' } });
    fireEvent.change(within(dialog).getByLabelText('Height (in)'), { target: { value: '19,7' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0].body).toMatchObject({
      weightKg: 3.487,
      heightCm: 50,
      headCircumferenceCm: null,
    });
  });

  it('shows the stored values and sends them back unchanged when nothing is touched', async () => {
    const { writes } = await setup();
    fireEvent.click(screen.getAllByRole('button', { name: /^Edit measurement of/ })[0]);
    const dialog = await screen.findByRole('dialog');
    expect((within(dialog).getByLabelText('Weight (lb)') as HTMLInputElement).value).toBe('7');
    expect((within(dialog).getByLabelText('Weight (oz)') as HTMLInputElement).value).toBe('11');
    expect((within(dialog).getByLabelText('Height (in)') as HTMLInputElement).value).toBe('19.7');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0].body).toMatchObject({
      weightKg: 3.5,
      heightCm: 50,
      headCircumferenceCm: 33.5,
    });
  });

  it('checks the limits after the conversion and words the error in pounds', async () => {
    const { writes } = await setup();
    fireEvent.click(await screen.findByRole('button', { name: 'Add measurement' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Weight (lb)'), { target: { value: '0' } });
    fireEvent.change(within(dialog).getByLabelText('Weight (oz)'), { target: { value: '3' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    expect(
      await within(dialog).findByText('Weight must be between 11 oz and 88 lb 3 oz.'),
    ).toBeTruthy();
    expect(writes()).toHaveLength(0);
  });

  it('speaks Portuguese: comma, pol. and libras', async () => {
    await useTestLocale('pt-BR');
    const { writes } = await setup();
    const item = within(await screen.findByRole('list', { name: 'Medidas' })).getAllByRole(
      'listitem',
    )[0];
    expect(item.textContent).toContain('7 lb 11 oz');
    expect(item.textContent).toContain('19,7 pol.');
    fireEvent.click(screen.getAllByRole('button', { name: /^Editar medida/ })[0]);
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0].body).toMatchObject({ weightKg: 3.5, heightCm: 50 });
  });
});
