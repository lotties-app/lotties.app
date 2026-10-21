import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BabyRoutineDb } from '../db/database';
import { createEvent } from '../db/eventCommands';
import { BABY_ID, fakeApi, httpError, testDatabase } from '../test/fakeApi';
import { renderWithDb, settleSync } from '../test/renderApp';
import { BELLY, DIAPER, FEEDING, seedBaby } from '../test/seed';
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

describe('HomePage', () => {
  it('offers a create form in the empty state', async () => {
    renderWithDb(db, <HomePage />);
    expect(await screen.findByText('No baby yet')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Create baby' })).toBeTruthy();
  });

  describe('creating a baby', () => {
    const created = { id: 'baby-9', name: 'Mia', birthDate: '2026-09-01', role: 'Owner' };

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
      fireEvent.change(screen.getByLabelText(/^Birth date/), { target: { value: '2026-09-01' } });
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
      fireEvent.change(screen.getByLabelText(/^Birth date/), { target: { value: '2026-09-01' } });
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

  it('disables logging for viewers and explains why', async () => {
    await seedBaby(db, { role: 'Viewer' });
    const running = await createEvent(db, { babyId: BABY_ID, typeId: FEEDING });
    renderWithDb(db, <HomePage />);

    expect(await screen.findByText(/view-only access/)).toBeTruthy();
    for (const name of ['Log Diaper', 'Log Belly pain', 'Log Medication']) {
      expect((screen.getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(true);
    }
    expect(
      (screen.getByRole('button', { name: 'Stop Feeding' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Log Diaper' }));
    expect(screen.queryByRole('heading', { name: 'Add event' })).toBeNull();
    expect((await db.events.get(running.id))?.endedAt).toBeNull();
  });

  it('starts a timer with one tap on a duration type, then stops it', async () => {
    await seedBaby(db);
    renderWithDb(db, <HomePage />);

    fireEvent.click(await screen.findByRole('button', { name: 'Start Feeding' }));

    const stop = await screen.findByRole('button', { name: 'Stop Feeding' });
    const [running] = await db.events.toArray();
    expect(running).toMatchObject({ typeId: FEEDING, babyId: BABY_ID, endedAt: null });
    expect(await db.outbox.count()).toBe(1);
    const start = screen.getByRole('button', { name: 'Start Feeding' }) as HTMLButtonElement;
    expect(start.disabled).toBe(true);

    fireEvent.click(stop);
    await waitFor(async () => expect((await db.events.get(running.id))?.endedAt).not.toBeNull());
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Stop Feeding' })).toBeNull());
  });

  it('logs an instant event through the sheet', async () => {
    await seedBaby(db);
    renderWithDb(db, <HomePage />);

    fireEvent.click(await screen.findByRole('button', { name: 'Log Diaper' }));
    expect(await screen.findByRole('heading', { name: 'Add event' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'DIRTY' }));
    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: ' leaked ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(async () => expect(await db.events.count()).toBe(1));
    const [saved] = await db.events.toArray();
    expect(saved).toMatchObject({ typeId: DIAPER, payload: { content: 'DIRTY' }, notes: 'leaked' });
    expect(saved.endedAt).toBe(saved.startedAt);
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Add event' })).toBeNull());
  });

  it('renders belly pain intensity as a 1-5 control and requires a value', async () => {
    await seedBaby(db);
    renderWithDb(db, <HomePage />);

    fireEvent.click(await screen.findByRole('button', { name: 'Log Belly pain' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Intensity is required.')).toBeTruthy();
    expect(await db.events.count()).toBe(0);

    for (const n of ['1', '2', '3', '4', '5']) {
      expect(screen.getByRole('button', { name: n })).toBeTruthy();
    }
    fireEvent.click(screen.getByRole('button', { name: '4' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(async () => expect(await db.events.count()).toBe(1));
    const [saved] = await db.events.toArray();
    expect(saved).toMatchObject({ typeId: BELLY, payload: { intensity: 4 } });
  });

  it('uses the baby remembered in localStorage', async () => {
    await seedBaby(db);
    await db.babies.put({ id: 'baby-2', name: 'Theo', birthDate: '2026-01-01', role: 'Owner' });
    window.localStorage.setItem('baby-routine.selected-baby', 'baby-2');
    renderWithDb(db, <HomePage />);

    fireEvent.click(await screen.findByRole('button', { name: 'Start Feeding' }));
    await waitFor(async () => expect((await db.events.toArray())[0]?.babyId).toBe('baby-2'));
  });
});
