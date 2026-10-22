import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BabyRoutineDb } from '../../db/database';
import { fakeApi, testDatabase } from '../../test/fakeApi';
import { renderWithDb, settleSync } from '../../test/renderApp';
import { BABY, nowApi, putEvent, seedMorning, seedNow } from './nowKit';
import { NowScreen } from './NowScreen';

let db: BabyRoutineDb;

beforeEach(() => {
  db = testDatabase();
});

afterEach(async () => {
  await settleSync();
  vi.restoreAllMocks();
  await db.delete();
});

function renderNow() {
  const { api } = fakeApi(nowApi());
  return renderWithDb(db, <NowScreen baby={BABY} />, { api });
}

const stateCard = () => screen.findByRole('region', { name: 'Current state' });
const byId = async (id: string) => (await db.events.get(id))!;

describe('pausing on the Now screen', () => {
  it('the state card pauses the sleep timer without waking the baby', async () => {
    await seedNow(db);
    await seedMorning(db, 112);
    const nap = await putEvent(db, 'sleep', 25, null, { kind: 'nap' });
    renderNow();

    const card = await stateCard();
    expect(within(card).getByText('Asleep · Nap')).toBeTruthy();
    fireEvent.click(within(card).getByRole('button', { name: 'Pause Nap' }));
    expect(await within(card).findByRole('button', { name: 'Resume Nap' })).toBeTruthy();
    expect((await byId(nap.id)).payload.paused_at).toEqual(expect.any(String));
    // Still asleep: the pause is not a wake-up, and the big action is unchanged.
    expect(within(card).getByText('Asleep · Nap')).toBeTruthy();
    expect(within(card).getByRole('button', { name: 'Woke up' })).toBeTruthy();
    expect(within(card).getByTestId('timer-paused').textContent).toMatch(/^Paused 00:0\d$/);
    expect((await byId(nap.id)).endedAt).toBeNull();

    fireEvent.click(within(card).getByRole('button', { name: 'Resume Nap' }));
    await waitFor(async () =>
      expect((await byId(nap.id)).payload).toMatchObject({ pause_count: 1 }),
    );
    // The database changes before the card re-renders: wait for the badge instead of racing it.
    await waitFor(() => expect(within(card).queryByTestId('timer-paused')).toBeNull());
  });

  it('shows the effective minutes of a nap that had a pause', async () => {
    await seedNow(db);
    await seedMorning(db, 112);
    await putEvent(db, 'sleep', 40, null, { kind: 'nap', paused_seconds: 600, pause_count: 1 });
    renderNow();
    const card = await stateCard();
    expect(within(card).getByTestId('state-duration').textContent).toBe('30m');
  });

  it('the nursing card freezes its clocks while paused', async () => {
    await seedNow(db);
    await seedMorning(db, 112);
    const feed = await putEvent(db, 'feeding', 6, null, {
      method: 'breast',
      side: 'left',
      side_since: new Date(Date.now() - 6 * 60_000).toISOString(),
    });
    renderNow();
    const card = await screen.findByRole('region', { name: 'Nursing' });
    fireEvent.click(within(card).getByRole('button', { name: 'Pause Nursing' }));
    expect(await within(card).findByRole('button', { name: 'Resume Nursing' })).toBeTruthy();
    expect(within(card).getByTestId('timer-paused')).toBeTruthy();
    expect((await byId(feed.id)).payload.paused_at).toEqual(expect.any(String));
    // The card shows the earlier of its last tick and the pause: let one tick pass so the frozen
    // value is on screen (a slow run can also put the pause a second after the 06:00 mark).
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const total = within(card).getByTestId('nursing-total').textContent;
    expect(total).toMatch(/^06:0\d$/);
    await new Promise((resolve) => setTimeout(resolve, 1200));
    expect(within(card).getByTestId('nursing-total').textContent).toBe(total);
  });

  it('the other timers get a pause button and a calm paused label', async () => {
    await seedNow(db);
    await seedMorning(db, 112);
    const tummy = await putEvent(db, 'tummy_time', 4, null, {});
    renderNow();
    const region = await screen.findByRole('region', { name: 'Running timers' });
    fireEvent.click(within(region).getByRole('button', { name: 'Pause Tummy time' }));
    await waitFor(async () =>
      expect((await byId(tummy.id)).payload.paused_at).toEqual(expect.any(String)),
    );
    expect(await within(region).findByRole('button', { name: 'Resume Tummy time' })).toBeTruthy();
    expect(within(region).getByTestId('timer-paused')).toBeTruthy();
  });

  it('is off for viewers', async () => {
    await seedNow(db, { role: 'Viewer' });
    await seedMorning(db, 112);
    await putEvent(db, 'sleep', 25, null, { kind: 'nap' });
    const { api } = fakeApi(nowApi());
    renderWithDb(db, <NowScreen baby={{ ...BABY, role: 'Viewer' }} />, { api });
    const card = await stateCard();
    expect(
      (within(card).getByRole('button', { name: 'Pause Nap' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});
