import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BabyRoutineDb } from '../db/database';
import type { BabyRole } from '../db/models';
import type { MeasurementDto } from '../sync/contract';
import { BABY_ID, fakeApi, httpError, testDatabase, type ApiCall } from '../test/fakeApi';
import { renderWithDb, settleSync } from '../test/renderApp';
import { seedBaby } from '../test/seed';
import { GrowthPage } from './GrowthPage';

let db: BabyRoutineDb;

beforeEach(() => {
  db = testDatabase();
});

afterEach(async () => {
  await settleSync();
  vi.restoreAllMocks();
  await db.delete();
});

const BASE = `/api/v1/babies/${BABY_ID}/measurements`;

function measurement(id: string, date: string, overrides: Partial<MeasurementDto> = {}) {
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
  measurement('m-old', '2026-09-01', { weightKg: 4.1, heightCm: 54 }),
  measurement('m-new', '2026-10-10', {
    weightKg: 5.2,
    headCircumferenceCm: 38.5,
    notes: 'Checkup',
  }),
];

async function setup(
  role: BabyRole = 'Parent',
  handler: (call: ApiCall) => unknown = () => undefined,
) {
  await seedBaby(db, { role });
  const fake = fakeApi((call) => {
    if (call.method === 'GET' && call.path === BASE) return SERVER;
    return handler(call);
  });
  renderWithDb(db, <GrowthPage />, { api: fake.api });
  await screen.findByRole('list', { name: 'Measurements' });
  return fake;
}

const openAdd = async () => {
  fireEvent.click(await screen.findByRole('button', { name: 'Add measurement' }));
  return screen.findByRole('dialog');
};

describe('GrowthPage', () => {
  it('lists measurements newest first with a chart per metric', async () => {
    await setup();
    const items = within(screen.getByRole('list', { name: 'Measurements' })).getAllByRole(
      'listitem',
    );
    expect(items[0].textContent).toContain('Weight 5.2 kg');
    expect(items[0].textContent).toContain('Head circumference 38.5 cm');
    expect(items[0].textContent).toContain('Checkup');
    expect(items[1].textContent).toContain('Height 54 cm');
    expect(screen.getAllByRole('img')).toHaveLength(3);
    expect(screen.getAllByTestId('chart-point')).toHaveLength(4);
  });

  it('adds a measurement with a client GUID and reloads the list', async () => {
    const { calls, writes } = await setup();
    const dialog = await openAdd();
    fireEvent.change(within(dialog).getByLabelText('Weight (kg)'), { target: { value: '5,6' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(writes()).toHaveLength(1));
    const put = writes()[0];
    expect(put.method).toBe('PUT');
    expect(put.path).toMatch(new RegExp(`^${BASE}/[0-9a-f-]{36}$`));
    expect(put.body).toMatchObject({ weightKg: 5.6, heightCm: null, headCircumferenceCm: null });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(calls.filter((c) => c.method === 'GET' && c.path === BASE).length).toBeGreaterThan(1);
  });

  it('validates locally and does not call the server', async () => {
    const { writes } = await setup();
    const dialog = await openAdd();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByText(/at least one of weight/)).toBeTruthy();

    fireEvent.change(within(dialog).getByLabelText('Weight (kg)'), { target: { value: '50' } });
    fireEvent.change(within(dialog).getByLabelText('Height (cm)'), { target: { value: '10' } });
    fireEvent.change(within(dialog).getByLabelText(/^Date/), { target: { value: '2999-01-01' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    expect(await within(dialog).findByText('Weight must be between 0.3 and 40 kg.')).toBeTruthy();
    expect(within(dialog).getByText('Height must be between 20 and 130 cm.')).toBeTruthy();
    expect(within(dialog).getByText('The date cannot be in the future.')).toBeTruthy();
    expect(writes()).toHaveLength(0);
  });

  it('shows friendly messages for 422 and 400 answers', async () => {
    let status = 422;
    await setup('Parent', (call) => {
      if (call.method === 'PUT') {
        throw status === 422
          ? httpError(422, 'measurement_without_values')
          : httpError(400, 'validation_failed');
      }
    });
    const dialog = await openAdd();
    fireEvent.change(within(dialog).getByLabelText('Weight (kg)'), { target: { value: '5' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(
      await within(dialog).findByText(
        'Enter at least one of weight, height or head circumference.',
      ),
    ).toBeTruthy();

    status = 400;
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByText(/server rejected some values/)).toBeTruthy();
  });

  it('edits and deletes an existing measurement', async () => {
    const { writes } = await setup();

    fireEvent.click(screen.getAllByRole('button', { name: /^Edit measurement of/ })[0]);
    const dialog = await screen.findByRole('dialog');
    expect((within(dialog).getByLabelText('Weight (kg)') as HTMLInputElement).value).toBe('5.2');
    fireEvent.change(within(dialog).getByLabelText('Weight (kg)'), { target: { value: '5.4' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toMatchObject({
      method: 'PUT',
      path: `${BASE}/m-new`,
      body: { date: '2026-10-10', weightKg: 5.4, headCircumferenceCm: 38.5, notes: 'Checkup' },
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    fireEvent.click(screen.getAllByRole('button', { name: /^Delete measurement of/ })[1]);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete measurement' }));
    await waitFor(() => expect(writes()).toHaveLength(2));
    expect(writes()[1]).toMatchObject({ method: 'DELETE', path: `${BASE}/m-old` });
  });

  it('is read-only for viewers', async () => {
    await setup('Viewer');
    expect(screen.getByText('You have view-only access to Lia.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add measurement' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Edit measurement/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Delete measurement/ })).toBeNull();
    expect(screen.getAllByRole('img')).toHaveLength(3);
  });

  it('says so when offline and blocks writes', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    await seedBaby(db, { role: 'Parent' });
    const fake = fakeApi();
    renderWithDb(db, <GrowthPage />, { api: fake.api });
    expect(await screen.findByText(/You are offline/)).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: 'Add measurement' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(fake.calls.filter((c) => c.path === BASE)).toHaveLength(0);
  });

  it('shows empty states without measurements', async () => {
    await seedBaby(db);
    renderWithDb(db, <GrowthPage />, {
      api: fakeApi((c) => (c.path === BASE ? [] : undefined)).api,
    });
    expect(await screen.findByText('No measurements yet.')).toBeTruthy();
    expect(screen.getByText('No weight measurements yet.')).toBeTruthy();
    expect(screen.queryByRole('img')).toBeNull();
  });
});
