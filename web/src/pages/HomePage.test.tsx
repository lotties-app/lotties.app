import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
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
import { DIAPER, seedBabiesListed, seedBaby } from '../test/seed';
import { HomePage } from './HomePage';

let db: BabyRoutineDb;

beforeEach(() => {
  db = testDatabase();
});

afterEach(async () => {
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

const tileNames = () =>
  within(screen.getByTestId('quick-actions'))
    .getAllByRole('button')
    .map((b) => b.getAttribute('aria-label'));

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

describe('HomePage quick actions (presets)', () => {
  it('shows the pinned presets Wake-up, Bottle, Diaper, Nap in that order, with status lines', async () => {
    await seedBuiltIns();
    renderWithDb(db, <HomePage />);

    await screen.findByTestId('quick-actions');
    expect(tileNames()).toEqual([
      'Log Wake-up, Not tracked today',
      'Log Bottle, Not tracked today',
      'Log Diaper, Not tracked today',
      'Start Nap, Not tracked today',
    ]);
  });

  it('keeps the same order whatever the event type ids are', async () => {
    await db.babies.put({ id: BABY_ID, name: 'Lia', birthDate: '2026-08-01', role: 'Owner' });
    await db.eventTypes.bulkPut(
      [FEEDING_DTO, SLEEP_DTO, DIAPER_DTO].map((dto, i) =>
        fromEventTypeDto({ ...dto, id: `00${3 - i}-${dto.key}` }),
      ),
    );
    renderWithDb(db, <HomePage />);
    await screen.findByTestId('quick-actions');
    expect(tileNames().map((n) => n?.split(',')[0])).toEqual([
      'Log Wake-up',
      'Log Bottle',
      'Log Diaper',
      'Start Nap',
    ]);
  });

  it('disables logging for viewers and explains why', async () => {
    await seedBaby(db, { role: 'Viewer' });
    const running = await createEvent(db, {
      babyId: BABY_ID,
      typeId: 'type-feeding',
      payload: { method: 'breast' },
    });
    renderWithDb(db, <HomePage />);

    expect(await screen.findByText(/view-only access/)).toBeTruthy();
    for (const button of within(screen.getByTestId('quick-actions')).getAllByRole('button')) {
      expect((button as HTMLButtonElement).disabled).toBe(true);
    }
    expect(
      (screen.getByRole('button', { name: 'Stop Feeding' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /^Log Diaper/ }));
    expect(screen.queryByRole('heading', { name: 'Add event' })).toBeNull();
    expect((await db.events.get(running.id))?.endedAt).toBeNull();
  });

  it('starts a timer preset with one tap, offers Undo, and stops it from the running card', async () => {
    await seedBuiltIns();
    renderWithDb(db, <HomePage />);

    fireEvent.click(await screen.findByRole('button', { name: /^Start Nap/ }));

    expect(await screen.findByText('Nap started')).toBeTruthy();
    const stop = await screen.findByRole('button', { name: 'Stop Sleep' });
    const [running] = await db.events.toArray();
    expect(running).toMatchObject({ babyId: BABY_ID, endedAt: null, payload: { kind: 'nap' } });
    expect(await screen.findByRole('button', { name: /^Stop Nap, Running 0:00/ })).toBeTruthy();

    fireEvent.click(stop);
    await waitFor(async () => expect((await db.events.get(running.id))?.endedAt).not.toBeNull());
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Stop Sleep' })).toBeNull());
  });

  it('undoes an instant preset from the snackbar', async () => {
    await seedBuiltIns();
    renderWithDb(db, <HomePage />);

    fireEvent.click(await screen.findByRole('button', { name: /^Log Wake-up/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }));

    await waitFor(async () => {
      const [event] = await db.events.toArray();
      expect(event.deletedAt).not.toBeNull();
    });
  });

  it('opens the Bottle sheet with bottle fields only, and saves an instant feed', async () => {
    await seedBuiltIns();
    renderWithDb(db, <HomePage />);

    fireEvent.click(await screen.findByRole('button', { name: /^Log Bottle/ }));

    expect(await screen.findByRole('heading', { name: 'Add event' })).toBeTruthy();
    const bottle = screen.getByRole('button', { name: 'Bottle' });
    expect(bottle.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByLabelText('Amount')).toBeTruthy();
    expect(screen.queryByText('Side')).toBeNull();
    expect(screen.queryByLabelText('Food')).toBeNull();
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '120' } });
    fireEvent.click(screen.getByRole('button', { name: 'Formula' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(async () => expect(await db.events.count()).toBe(1));
    const [saved] = await db.events.toArray();
    expect(saved.payload).toEqual({
      method: 'bottle',
      amount_ml: 120,
      bottle_feeding_type: 'formula',
    });
    expect(saved.endedAt).toBe(saved.startedAt);
  });

  it('logs an instant event through the sheet', async () => {
    await seedBaby(db);
    renderWithDb(db, <HomePage />);

    fireEvent.click(await screen.findByRole('button', { name: /^Log Diaper/ }));
    expect(await screen.findByRole('heading', { name: 'Add event' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Dirty' }));
    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: ' leaked ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(async () => expect(await db.events.count()).toBe(1));
    const [saved] = await db.events.toArray();
    expect(saved).toMatchObject({ typeId: DIAPER, payload: { content: 'DIRTY' }, notes: 'leaked' });
    expect(saved.endedAt).toBe(saved.startedAt);
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Add event' })).toBeNull());
  });

  it('uses the baby remembered in localStorage', async () => {
    await seedBaby(db);
    await db.babies.put({ id: 'baby-2', name: 'Theo', birthDate: '2026-01-01', role: 'Owner' });
    window.localStorage.setItem('baby-routine.selected-baby', 'baby-2');
    renderWithDb(db, <HomePage />);

    fireEvent.click(await screen.findByRole('button', { name: /^Start Nursing/ }));
    await waitFor(async () => expect((await db.events.toArray())[0]?.babyId).toBe('baby-2'));
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

    fireEvent.click(screen.getByRole('button', { name: 'Breast' }));
    // The breast fields expand once the method is chosen.
    expect(await screen.findByText('Side')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Left' }));
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
    expect(screen.getByRole('button', { name: 'Bottle' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
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
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));

    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'Finish this feeding' })).toBeNull(),
    );
    expect((await db.events.get(running.id))?.endedAt).toBeNull();
  });

  it('stops at once when the payload is complete (Nursing sets the method)', async () => {
    await seedBuiltIns();
    const running = await createEvent(db, {
      babyId: BABY_ID,
      typeId: FEEDING_TYPE.id,
      payload: { method: 'breast' },
    });
    renderWithDb(db, <HomePage />);

    fireEvent.click(await screen.findByRole('button', { name: 'Stop Feeding' }));

    await waitFor(async () => expect((await db.events.get(running.id))?.endedAt).not.toBeNull());
    expect(screen.queryByRole('heading', { name: 'Finish this feeding' })).toBeNull();
  });
});
