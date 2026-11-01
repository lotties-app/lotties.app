import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BabyRoutineDb } from '../db/database';
import { createEvent } from '../db/eventCommands';
import { storeTimeBottles } from '../presets/timeBottlesStorage';
import { FEEDING_TYPE } from '../test/builtInTypes';
import { BABY_ID, testDatabase } from '../test/fakeApi';
import { renderWithDb } from '../test/renderApp';
import { seedBaby } from '../test/seed';
import { EventSheet } from './EventSheet';

/*
 * The bottle in the event sheet (docs/design/20-feeding-amounts.md): prepared and drunk amounts,
 * the drunk quick choices, and "Time bottle feedings" off making a new bottle a moment.
 */

let db: BabyRoutineDb;

beforeEach(async () => {
  window.localStorage.clear();
  db = testDatabase();
  await seedBaby(db);
});

afterEach(async () => {
  await db.delete();
});

function renderSheet(props: Partial<Parameters<typeof EventSheet>[0]> = {}) {
  const onDone = vi.fn();
  renderWithDb(
    db,
    <EventSheet
      babyId={BABY_ID}
      types={[FEEDING_TYPE]}
      initialTypeId={FEEDING_TYPE.id}
      onDone={onDone}
      {...props}
    />,
  );
  return onDone;
}

const choose = (name: string) => fireEvent.click(screen.getByRole('radio', { name }));
const save = () => fireEvent.click(screen.getByRole('button', { name: 'Save' }));
const typePrepared = (value: string) =>
  fireEvent.change(screen.getByRole('spinbutton', { name: /Amount prepared/ }), {
    target: { value },
  });

describe('a new bottle with "Time bottle feedings" off (the default)', () => {
  it('is a moment: start = end, no "Still running", both amounts asked', async () => {
    const onDone = renderSheet();
    choose('Bottle');

    expect(screen.queryByRole('switch', { name: 'Still running' })).toBeNull();
    expect(screen.getByText('Amount prepared')).toBeTruthy();
    expect(screen.getByText('Amount drunk')).toBeTruthy();
    typePrepared('120');
    save();

    await waitFor(() => expect(onDone).toHaveBeenCalled());
    const [saved] = await db.events.toArray();
    expect(saved.endedAt).toBe(saved.startedAt);
    expect(saved.payload).toEqual({ method: 'bottle', amount_ml: 120 });
  });

  it('nursing still starts as a timer', async () => {
    const onDone = renderSheet();
    choose('Breast');

    expect(screen.getByRole('switch', { name: 'Still running' }).getAttribute('aria-checked')).toBe(
      'true',
    );
    save();
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect((await db.events.toArray())[0].endedAt).toBeNull();
  });

  it('on, a new bottle is a timer again', async () => {
    storeTimeBottles(true);
    renderSheet();
    choose('Bottle');
    expect(screen.getByRole('switch', { name: 'Still running' }).getAttribute('aria-checked')).toBe(
      'true',
    );
  });

  it('a stored bottle with a duration keeps it when edited', async () => {
    const start = new Date(2026, 9, 21, 10, 0);
    const stored = await createEvent(db, {
      babyId: BABY_ID,
      typeId: FEEDING_TYPE.id,
      startedAt: start.toISOString(),
      endedAt: new Date(start.getTime() + 15 * 60_000).toISOString(),
      payload: { method: 'bottle', amount_ml: 100 },
    });
    const onDone = renderSheet({ event: stored });

    save();

    await waitFor(() => expect(onDone).toHaveBeenCalled());
    const saved = (await db.events.get(stored.id))!;
    expect(Date.parse(saved.endedAt!) - Date.parse(saved.startedAt)).toBe(15 * 60_000);
  });
});

describe('the drunk amount', () => {
  it('has quick choices that follow the prepared amount, and saves the chosen share', async () => {
    const onDone = renderSheet();
    choose('Bottle');
    typePrepared('100');

    fireEvent.click(screen.getByRole('button', { name: /^75 ml.*3\/4/ }));
    expect(screen.getByRole('button', { name: /^25 ml.*1\/4/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^50 ml.*half/ })).toBeTruthy();
    save();

    await waitFor(() => expect(onDone).toHaveBeenCalled());
    const [saved] = await db.events.toArray();
    expect(saved.payload).toEqual({ method: 'bottle', amount_ml: 100, amount_drunk_ml: 75 });
  });

  it('choosing "all" stores no drunk amount (a bottle without one was fully drunk)', async () => {
    const onDone = renderSheet();
    choose('Bottle');
    typePrepared('100');

    fireEvent.click(screen.getByRole('button', { name: /^100 ml.*all/ }));
    save();

    await waitFor(() => expect(onDone).toHaveBeenCalled());
    const [saved] = await db.events.toArray();
    expect(saved.payload).toEqual({ method: 'bottle', amount_ml: 100 });
  });

  it('cannot be more than the prepared amount', async () => {
    const stored = await createEvent(db, {
      babyId: BABY_ID,
      typeId: FEEDING_TYPE.id,
      startedAt: new Date(2026, 9, 21, 10, 0).toISOString(),
      endedAt: new Date(2026, 9, 21, 10, 0).toISOString(),
      payload: { method: 'bottle', amount_ml: 120, amount_drunk_ml: 100 },
    });
    const onDone = renderSheet({ event: stored });

    // Preparing less than what was recorded as drunk is a problem shown under the drunk amount.
    typePrepared('80');
    save();

    expect(
      (await screen.findAllByText(/can't be more than the amount prepared/)).length,
    ).toBeGreaterThan(0);
    expect(onDone).not.toHaveBeenCalled();
  });
});

describe('the ended-by-sleep marker', () => {
  it('survives an edit of the feeding', async () => {
    const start = new Date(2026, 9, 21, 10, 0);
    const stored = await createEvent(db, {
      babyId: BABY_ID,
      typeId: FEEDING_TYPE.id,
      startedAt: start.toISOString(),
      endedAt: new Date(start.getTime() + 20 * 60_000).toISOString(),
      payload: { method: 'breast', side: 'left', ended_by: 'sleep' },
    });
    const onDone = renderSheet({ event: stored });

    save();

    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect((await db.events.get(stored.id))?.payload).toMatchObject({ ended_by: 'sleep' });
  });
});
