import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BabyRoutineDb } from '../db/database';
import { createEvent } from '../db/eventCommands';
import { recordLastUsed } from '../events/lastUsedValues';
import { SyncEngine } from '../sync/SyncEngine';
import { BABY_ID, fakeApi, httpError, networkError, testDatabase } from '../test/fakeApi';
import { setDateField } from '../test/dateField';
import { renderWithDb, settleSync } from '../test/renderApp';
import {
  DIAPER_DTO,
  FEEDING_DTO,
  FEEDING_TYPE,
  SLEEP_DTO,
  BREAST_PUMP_DTO,
} from '../test/builtInTypes';
import { fromEventTypeDto } from '../sync/contract';
import { seedBabiesListed } from '../test/seed';
import { HomePage } from './HomePage';

let db: BabyRoutineDb;

beforeEach(() => {
  db = testDatabase();
});

afterEach(async () => {
  vi.useRealTimers();
  await settleSync();
  vi.restoreAllMocks();
  await db.delete();
});

/** The real built-in types (feeding with its conditional fields, sleep, diaper, breast pump). */
async function seedBuiltIns(role: 'Owner' | 'Viewer' = 'Owner') {
  await db.babies.put({ id: BABY_ID, name: 'Lia', birthDate: '2026-08-01', role });
  await db.eventTypes.bulkPut(
    [FEEDING_DTO, SLEEP_DTO, DIAPER_DTO, BREAST_PUMP_DTO].map(fromEventTypeDto),
  );
}

function startedEngine(api = fakeApi().api, isOnline = () => true) {
  const engine = new SyncEngine({ db, api, locks: null, eventTarget: null, isOnline });
  return engine;
}

describe('HomePage without a baby (M6)', () => {
  it('offers a create form once the server confirmed the list is empty', async () => {
    await seedBabiesListed(db);
    renderWithDb(db, <HomePage />);
    expect(await screen.findByText('No baby yet')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Create baby' })).toBeTruthy();
  });

  it('shows a retry card instead of "Create baby" when the server fails on a fresh device', async () => {
    let down = true;
    const { api } = fakeApi((call) => {
      if (call.path === '/api/v1/babies') {
        if (down) throw httpError(500);
        return [];
      }
    });
    const engine = startedEngine(api);
    renderWithDb(db, <HomePage />, { api, engine });

    await act(() => engine.syncNow());

    expect(await screen.findByRole('heading', { name: "Couldn't reach the server" })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Create baby' })).toBeNull();
    expect(screen.queryByText(/HTTP|500/)).toBeNull();

    down = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByRole('button', { name: 'Create baby' })).toBeTruthy();
  });

  it('says it is offline on a fresh device without a connection', async () => {
    const { api } = fakeApi((call) => {
      if (call.method === 'GET') throw networkError();
    });
    const engine = startedEngine(api, () => false);
    renderWithDb(db, <HomePage />, { api, engine });

    await act(() => engine.syncNow());

    expect(await screen.findByText(/You are offline. Your babies load once/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Create baby' })).toBeNull();
  });

  it('keeps showing the spinner while the first sync is still running', async () => {
    renderWithDb(db, <HomePage />);
    expect(await screen.findByLabelText('Loading')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Create baby' })).toBeNull();
  });

  describe('creating a baby', () => {
    const created = { id: 'baby-9', name: 'Mia', birthDate: '2026-09-01', role: 'Owner' };

    beforeEach(() => seedBabiesListed(db));

    it('validates, posts online, selects the new baby and refreshes the catalogs', async () => {
      let exists = false;
      const { api, calls, writes } = fakeApi((call) => {
        if (call.method === 'POST') {
          exists = true;
          return created;
        }
        if (call.path === '/api/v1/babies') return exists ? [created] : [];
      });
      renderWithDb(db, <HomePage />, { api });

      fireEvent.click(await screen.findByRole('button', { name: 'Create baby' }));
      expect(await screen.findByText('Name is required.')).toBeTruthy();
      expect(screen.getByText('Birth date is required.')).toBeTruthy();
      expect(writes()).toHaveLength(0);

      fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: ' Mia ' } });
      await setDateField(/^Birth date/, '2026-09-01');
      fireEvent.click(screen.getByRole('button', { name: 'Create baby' }));

      await waitFor(() => expect(writes()).toHaveLength(1));
      expect(writes()[0]).toMatchObject({
        method: 'POST',
        path: '/api/v1/babies',
        body: { name: 'Mia', birthDate: '2026-09-01' },
      });
      expect(await screen.findByText(/No event types yet/)).toBeTruthy();
      expect(screen.queryByText('No baby yet')).toBeNull();
      expect(window.localStorage.getItem('baby-routine.selected-baby')).toBe('baby-9');
      expect(await db.babies.get('baby-9')).toEqual(created);
      await waitFor(() =>
        expect(calls.some((c) => c.path === '/api/v1/babies/baby-9/event-types')).toBe(true),
      );
    });

    it('shows a friendly message when the server rejects the request', async () => {
      const { api } = fakeApi((call) => {
        if (call.method === 'POST') throw httpError(403);
        if (call.path === '/api/v1/babies') return [];
      });
      renderWithDb(db, <HomePage />, { api });

      fireEvent.change(await screen.findByLabelText(/^Name/), { target: { value: 'Mia' } });
      await setDateField(/^Birth date/, '2026-09-01');
      fireEvent.click(screen.getByRole('button', { name: 'Create baby' }));

      expect(await screen.findByText('You do not have permission to do this.')).toBeTruthy();
      expect(screen.getByText('No baby yet')).toBeTruthy();
    });

    it('explains that creating needs a connection when offline', async () => {
      vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
      const { api, writes } = fakeApi((call) => (call.path === '/api/v1/babies' ? [] : undefined));
      renderWithDb(db, <HomePage />, { api });

      expect(await screen.findByText(/You are offline/)).toBeTruthy();
      const button = screen.getByRole('button', { name: 'Create baby' }) as HTMLButtonElement;
      expect(button.disabled).toBe(true);
      expect(writes()).toHaveLength(0);
    });
  });
});

describe('Stopping a timer without its required fields (feeding stop bug)', () => {
  it('asks for the missing method in a short sheet, then stops with it', async () => {
    await seedBuiltIns();
    const running = await createEvent(db, { babyId: BABY_ID, typeId: FEEDING_TYPE.id });
    renderWithDb(db, <HomePage />);

    fireEvent.click(await screen.findByRole('button', { name: 'Stop Feeding' }));

    expect(await screen.findByRole('heading', { name: 'Finish this feeding' })).toBeTruthy();
    // Nothing was committed yet.
    expect((await db.events.get(running.id))?.endedAt).toBeNull();
    expect(screen.queryByLabelText('Start')).toBeNull();
    expect(screen.queryByLabelText('Notes')).toBeNull();
    expect(screen.queryByText('Side')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Save and stop' }));
    expect(await screen.findByText('Method is required.')).toBeTruthy();

    fireEvent.click(screen.getByRole('radio', { name: 'Breast' }));
    // The breast fields expand once the method is chosen.
    expect(await screen.findByText('Side')).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: 'Left' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save and stop' }));

    await waitFor(async () => expect((await db.events.get(running.id))?.endedAt).not.toBeNull());
    const stopped = await db.events.get(running.id);
    expect(stopped?.payload).toEqual({ method: 'breast', side: 'left' });
    const [mutation] = (await db.outbox.toArray()).slice(-1);
    expect(mutation.payload).toMatchObject({ payload: { method: 'breast', side: 'left' } });
  });

  it('pre-selects the last used values, so the stop is one more tap', async () => {
    await seedBuiltIns();
    recordLastUsed(BABY_ID, FEEDING_TYPE, { method: 'bottle', amount_ml: 90 });
    const running = await createEvent(db, { babyId: BABY_ID, typeId: FEEDING_TYPE.id });
    renderWithDb(db, <HomePage />);

    fireEvent.click(await screen.findByRole('button', { name: 'Stop Feeding' }));
    await screen.findByRole('heading', { name: 'Finish this feeding' });
    expect(screen.getByRole('radio', { name: 'Bottle' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Save and stop' }));

    await waitFor(async () =>
      expect((await db.events.get(running.id))?.payload).toEqual({
        method: 'bottle',
        amount_ml: 90,
      }),
    );
    expect((await db.events.get(running.id))?.endedAt).not.toBeNull();
  });

  it('cancelling the sheet keeps the timer running', async () => {
    await seedBuiltIns();
    const running = await createEvent(db, { babyId: BABY_ID, typeId: FEEDING_TYPE.id });
    renderWithDb(db, <HomePage />);

    fireEvent.click(await screen.findByRole('button', { name: 'Stop Feeding' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Close' }));

    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'Finish this feeding' })).toBeNull(),
    );
    expect((await db.events.get(running.id))?.endedAt).toBeNull();
  });

  it('a bottle timer asks for the amount on stop, and stops without one too', async () => {
    window.localStorage.clear();
    await seedBuiltIns();
    const running = await createEvent(db, {
      babyId: BABY_ID,
      typeId: FEEDING_TYPE.id,
      payload: { method: 'bottle' },
    });
    renderWithDb(db, <HomePage />);

    fireEvent.click(await screen.findByRole('button', { name: 'Stop Bottle' }));
    expect(await screen.findByRole('heading', { name: 'Finish this feeding' })).toBeTruthy();
    expect(screen.getByText('Amount')).toBeTruthy();
    expect((await db.events.get(running.id))?.endedAt).toBeNull();
    // The amount is optional: Save and stop works with it left empty.
    fireEvent.click(screen.getByRole('button', { name: 'Save and stop' }));

    await waitFor(async () => expect((await db.events.get(running.id))?.endedAt).not.toBeNull());
    expect((await db.events.get(running.id))?.payload).toEqual({ method: 'bottle' });
  });

  it('a bottle timer stopped with an amount keeps it and its duration', async () => {
    // The amount chips follow Lia's age in months (docs/design/10-bottle-suggestions.md): pin the date
    // so she stays 2 months old and the 120 ml chip exists.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 21, 14, 0));
    window.localStorage.clear();
    await seedBuiltIns();
    const startedAt = new Date(Date.now() - 18 * 60_000).toISOString();
    const running = await createEvent(db, {
      babyId: BABY_ID,
      typeId: FEEDING_TYPE.id,
      startedAt,
      payload: { method: 'bottle' },
    });
    renderWithDb(db, <HomePage />);

    fireEvent.click(await screen.findByRole('button', { name: 'Stop Bottle' }));
    await screen.findByRole('heading', { name: 'Finish this feeding' });
    fireEvent.click(screen.getByRole('button', { name: /^120/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Save and stop' }));

    await waitFor(async () => expect((await db.events.get(running.id))?.endedAt).not.toBeNull());
    const stopped = await db.events.get(running.id);
    expect(stopped?.payload).toEqual({ method: 'bottle', amount_ml: 120 });
    expect(Date.parse(stopped!.endedAt!) - Date.parse(startedAt)).toBeGreaterThanOrEqual(
      18 * 60_000,
    );
  });

  it('a bottle timer that already has its amount stops at once', async () => {
    window.localStorage.clear();
    await seedBuiltIns();
    const running = await createEvent(db, {
      babyId: BABY_ID,
      typeId: FEEDING_TYPE.id,
      payload: { method: 'bottle', amount_ml: 90 },
    });
    renderWithDb(db, <HomePage />);

    fireEvent.click(await screen.findByRole('button', { name: 'Stop Bottle' }));
    await waitFor(async () => expect((await db.events.get(running.id))?.endedAt).not.toBeNull());
    expect(screen.queryByRole('heading', { name: 'Finish this feeding' })).toBeNull();
  });

  it('stops at once when the payload is complete (a nursing session has its method)', async () => {
    await seedBuiltIns();
    const running = await createEvent(db, {
      babyId: BABY_ID,
      typeId: FEEDING_TYPE.id,
      payload: { method: 'breast' },
    });
    renderWithDb(db, <HomePage />);

    // A nursing session has its own card: Finish stops it with the per-side seconds.
    fireEvent.click(await screen.findByRole('button', { name: 'Finish' }));

    await waitFor(async () => expect((await db.events.get(running.id))?.endedAt).not.toBeNull());
    expect(screen.queryByRole('heading', { name: 'Finish this feeding' })).toBeNull();
  });
});
