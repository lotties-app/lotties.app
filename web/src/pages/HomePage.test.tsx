import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BabyRoutineDb } from '../db/database';
import { BABY_ID, testDatabase } from '../test/fakeApi';
import { renderWithDb } from '../test/renderApp';
import { BELLY, DIAPER, FEEDING, seedBaby } from '../test/seed';
import { HomePage } from './HomePage';

let db: BabyRoutineDb;

beforeEach(() => {
  db = testDatabase();
});

afterEach(async () => {
  await db.delete();
});

describe('HomePage', () => {
  it('explains the empty state when there is no baby', async () => {
    renderWithDb(db, <HomePage />);
    expect(await screen.findByText('No baby yet')).toBeTruthy();
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
    await db.babies.put({ id: 'baby-2', name: 'Theo', birthDate: '2026-01-01' });
    window.localStorage.setItem('baby-routine.selected-baby', 'baby-2');
    renderWithDb(db, <HomePage />);

    fireEvent.click(await screen.findByRole('button', { name: 'Start Feeding' }));
    await waitFor(async () => expect((await db.events.toArray())[0]?.babyId).toBe('baby-2'));
  });
});
