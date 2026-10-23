import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BabyRoutineDb } from '../../db/database';
import { storeTimeBottles } from '../../presets/timeBottlesStorage';
import { BABY_ID, fakeApi, testDatabase } from '../../test/fakeApi';
import { renderWithDb, settleSync } from '../../test/renderApp';
import { BABY, nowApi, putEvent, seedMorning, seedNow } from './nowKit';
import { NowScreen } from './NowScreen';

/*
 * Feeding amounts and timers on Now (docs/design/20-feeding-amounts.md): the Feed tray asks how
 * much was drunk, the bottle quick action follows "Time bottle feedings", and a sleep that starts
 * stops a running feeding.
 */

let db: BabyRoutineDb;

beforeEach(() => {
  window.localStorage.clear();
  db = testDatabase();
});

afterEach(async () => {
  await settleSync();
  vi.useRealTimers();
  vi.restoreAllMocks();
  await db.delete();
});

function renderNow() {
  const { api } = fakeApi(nowApi());
  return renderWithDb(db, <NowScreen baby={BABY} />, { api });
}

const live = async () => (await db.events.toArray()).filter((e) => e.deletedAt === null);
const logged = async () =>
  (await live()).filter((e) => Date.now() - Date.parse(e.createdAt) < 60_000);
const tile = (name: RegExp) => screen.findByRole('button', { name });

describe('the Feed tray asks how much was drunk', () => {
  it('offers all, 3/4, half and 1/4 of the amount; "all" is the default and logs no drunk amount', async () => {
    await seedNow(db);
    await seedMorning(db, 112);
    renderNow();

    fireEvent.click(await tile(/^Feed/));
    const tray = await screen.findByRole('dialog', { name: 'Feed' });
    const group = within(tray).getByRole('radiogroup', { name: 'How much was drunk' });
    expect(
      within(group)
        .getAllByRole('radio')
        .map((r) => r.textContent),
    ).toEqual(['30 ml · 1/4', '60 ml · half', '90 ml · 3/4', '120 ml · all']);
    expect(
      within(group).getByRole('radio', { name: '120 ml · all' }).getAttribute('aria-checked'),
    ).toBe('true');

    fireEvent.click(within(tray).getByRole('button', { name: 'Log 120 ml formula' }));

    await screen.findByText('Bottle logged, 120 ml');
    const [bottle] = (await logged()).filter((e) => e.payload.method === 'bottle');
    expect(bottle.payload).toEqual({
      method: 'bottle',
      amount_ml: 120,
      bottle_feeding_type: 'formula',
    });
  });

  it('a smaller share logs the drunk amount and the toast reads "60 of 120 ml"', async () => {
    await seedNow(db);
    await seedMorning(db, 112);
    renderNow();

    fireEvent.click(await tile(/^Feed/));
    const tray = await screen.findByRole('dialog', { name: 'Feed' });
    fireEvent.click(within(tray).getByRole('radio', { name: '60 ml · half' }));
    fireEvent.click(within(tray).getByRole('button', { name: 'Log 60 of 120 ml formula' }));

    await screen.findByText('Bottle logged, 60 of 120 ml');
    const [bottle] = (await logged()).filter((e) => e.payload.method === 'bottle');
    expect(bottle.payload).toEqual({
      method: 'bottle',
      amount_ml: 120,
      amount_drunk_ml: 60,
      bottle_feeding_type: 'formula',
    });
    expect(bottle.endedAt).toBe(bottle.startedAt);
  });

  it('changing the amount resets the share to all', async () => {
    await seedNow(db);
    await seedMorning(db, 112);
    renderNow();

    fireEvent.click(await tile(/^Feed/));
    const tray = await screen.findByRole('dialog', { name: 'Feed' });
    fireEvent.click(within(tray).getByRole('radio', { name: '60 ml · half' }));
    fireEvent.click(within(tray).getByRole('radio', { name: 'Other amount' }));
    fireEvent.click(within(tray).getByRole('button', { name: 'Increase' }));

    expect(within(tray).getByRole('button', { name: /^Log 130 ml/ })).toBeTruthy();
  });
});

describe('the bottle quick action and "Time bottle feedings"', () => {
  it('off (the default): it logs the feeding at once through the form, with no timer', async () => {
    await seedNow(db);
    await seedMorning(db, 112);
    renderNow();

    fireEvent.click(await tile(/^More/));
    fireEvent.click(await screen.findByRole('button', { name: /^Start Bottle/ }));

    const sheet = await screen.findByRole('dialog');
    expect(within(sheet).getByText('Amount prepared')).toBeTruthy();
    expect(within(sheet).getByText('Amount drunk')).toBeTruthy();
    expect(within(sheet).queryByRole('switch', { name: 'Still running' })).toBeNull();
    fireEvent.change(within(sheet).getByRole('spinbutton', { name: /Amount prepared/ }), {
      target: { value: '120' },
    });
    fireEvent.click(within(sheet).getByRole('button', { name: /^60 ml.*half/ }));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));

    await waitFor(async () =>
      expect((await logged()).some((e) => e.payload.method === 'bottle')).toBe(true),
    );
    const [bottle] = (await logged()).filter((e) => e.payload.method === 'bottle');
    expect(bottle.endedAt).toBe(bottle.startedAt);
    expect(bottle.payload).toMatchObject({ amount_ml: 120, amount_drunk_ml: 60 });
    expect((await live()).some((e) => e.endedAt === null)).toBe(false);
  });

  it('on: it starts a bottle timer, like before', async () => {
    storeTimeBottles(BABY_ID, true);
    await seedNow(db);
    await seedMorning(db, 112);
    renderNow();

    fireEvent.click(await tile(/^More/));
    fireEvent.click(await screen.findByRole('button', { name: /^Start Bottle/ }));

    await waitFor(async () =>
      expect((await live()).some((e) => e.endedAt === null && e.payload.method === 'bottle')).toBe(
        true,
      ),
    );
  });

  it('nursing keeps its timer with the setting off', async () => {
    await seedNow(db);
    await seedMorning(db, 112);
    renderNow();

    fireEvent.click(await tile(/^More/));
    fireEvent.click(await screen.findByRole('button', { name: /^Start Nursing/ }));

    expect(await screen.findByRole('region', { name: 'Nursing' })).toBeTruthy();
  });
});

describe('a sleep that starts stops the running feeding', () => {
  it('Fell asleep ends a nursing session at that moment and records it was ended by sleep', async () => {
    await seedNow(db);
    await seedMorning(db, 112);
    const feeding = await putEvent(db, 'feeding', 5, null, {
      method: 'breast',
      side: 'left',
      side_since: new Date(Date.now() - 5 * 60_000).toISOString(),
    });
    renderNow();

    fireEvent.click(await screen.findByRole('button', { name: 'Fell asleep' }));

    await waitFor(async () => expect((await db.events.get(feeding.id))?.endedAt).not.toBeNull());
    const stopped = (await db.events.get(feeding.id))!;
    expect(stopped.payload).toMatchObject({ method: 'breast', ended_by: 'sleep' });
    expect((await live()).some((e) => e.typeId !== feeding.typeId && e.endedAt === null)).toBe(
      true,
    );
  });
});
