import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BabyRoutineDb } from '../../db/database';
import type { Baby } from '../../db/models';
import { fakeApi, testDatabase } from '../../test/fakeApi';
import { renderWithDb, settleSync } from '../../test/renderApp';
import { isRunningControlChange } from '../../baby/permissions';
import { BABY, minutesAgo, nowApi, pinClock, putEvent, seedMorning, seedNow } from './nowKit';
import { NowScreen } from './NowScreen';

/*
 * Now for a Caregiver (docs/SPEC.md "Roles and permissions"): everything can be logged; timers
 * someone else started can be stopped, paused and resumed (nothing else; a nursing session, whose
 * side clock would change, stays locked and says who started it); no prescriptions are added.
 */

const CAREGIVER: Baby = { ...BABY, role: 'Caregiver', userId: 'u-me' };

let db: BabyRoutineDb;

beforeEach(() => {
  db = testDatabase();
});

afterEach(async () => {
  await settleSync();
  vi.useRealTimers();
  vi.restoreAllMocks();
  await db.delete();
});

async function renderNow(baby: Baby = CAREGIVER) {
  await db.babies.put(baby);
  const { api } = fakeApi(nowApi());
  return renderWithDb(db, <NowScreen baby={baby} />, { api });
}

describe('Now for a caregiver', () => {
  it('logs (no view-only notice, the tiles are on)', async () => {
    await seedNow(db, { role: 'Caregiver' });
    await seedMorning(db);
    await renderNow();
    const feed = await screen.findByRole('button', { name: /^Feed/ });
    expect((feed as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByText(/view-only access/)).toBeNull();
  });

  it('ends a nap someone else started with Woke up, changing only its end', async () => {
    pinClock(14);
    await seedNow(db, { role: 'Caregiver' });
    const nap = await putEvent(
      db,
      'sleep',
      30,
      null,
      { kind: 'nap' },
      { createdBy: 'u-ana', notes: 'from Ana' },
    );
    await renderNow();
    const wokeUp = await screen.findByRole('button', { name: 'Woke up' });
    expect((screen.getByRole('button', { name: /^Pause/ }) as HTMLButtonElement).disabled).toBe(
      false,
    );

    expect((wokeUp as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByText(/Started by/)).toBeNull();

    fireEvent.click(wokeUp);

    await waitFor(async () => expect((await db.events.get(nap.id))?.endedAt).not.toBeNull());
    const stopped = (await db.events.get(nap.id))!;
    expect(stopped).toMatchObject({ createdBy: 'u-ana', notes: 'from Ana' });
    expect(isRunningControlChange(nap, stopped)).toBe(true);
  });

  it('pauses a nap someone else started', async () => {
    pinClock(14);
    await seedNow(db, { role: 'Caregiver' });
    const nap = await putEvent(db, 'sleep', 30, null, { kind: 'nap' }, { createdBy: 'u-ana' });
    await renderNow();
    fireEvent.click(await screen.findByRole('button', { name: /^Pause/ }));
    await waitFor(async () =>
      expect((await db.events.get(nap.id))?.payload.paused_at).toBeDefined(),
    );
    expect(isRunningControlChange(nap, (await db.events.get(nap.id))!)).toBe(true);
  });

  it('ends a nap they started', async () => {
    pinClock(14);
    await seedNow(db, { role: 'Caregiver' });
    await putEvent(db, 'sleep', 30, null, { kind: 'nap' }, { createdBy: 'u-me' });
    await renderNow();
    const wokeUp = await screen.findByRole('button', { name: 'Woke up' });
    expect((wokeUp as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByText(/Started by/)).toBeNull();
  });

  it('stops another person’s timer as well as their own', async () => {
    await seedNow(db, { role: 'Caregiver' });
    await seedMorning(db);
    const tummy = await putEvent(db, 'tummy_time', 10, null, {}, { createdBy: 'u-ana' });
    await putEvent(db, 'bath', 5, null, {}, { createdBy: null });
    await renderNow();
    const timers = await screen.findByRole('region', { name: 'Running timers' });
    const [anas, mine] = within(timers).getAllByRole('article');
    for (const row of [anas, mine]) {
      expect(
        (within(row).getByRole('button', { name: /^Stop / }) as HTMLButtonElement).disabled,
      ).toBe(false);
    }
    expect(screen.queryByText(/Started by/)).toBeNull();

    fireEvent.click(within(anas).getByRole('button', { name: /^Stop / }));

    await waitFor(async () => expect((await db.events.get(tummy.id))?.endedAt).not.toBeNull());
  });

  it('stopping someone else’s bottle asks only for the amount and keeps the rest', async () => {
    await seedNow(db, { role: 'Caregiver' });
    await seedMorning(db);
    const bottle = await putEvent(
      db,
      'feeding',
      12,
      null,
      { method: 'bottle', bottle_feeding_type: 'formula' },
      { createdBy: 'u-ana', notes: 'from Ana' },
    );
    await renderNow();
    const timers = await screen.findByRole('region', { name: 'Running timers' });
    fireEvent.click(within(timers).getByRole('button', { name: /^Stop / }));
    const sheet = await screen.findByRole('dialog', { name: /^Finish this/ });
    fireEvent.change(within(sheet).getByRole('spinbutton', { name: /Amount prepared/ }), {
      target: { value: '90' },
    });
    fireEvent.click(within(sheet).getByRole('button', { name: /^Save/ }));

    await waitFor(async () => expect((await db.events.get(bottle.id))?.endedAt).not.toBeNull());
    const stopped = (await db.events.get(bottle.id))!;
    expect(stopped.payload).toEqual({
      method: 'bottle',
      bottle_feeding_type: 'formula',
      amount_ml: 90,
    });
    expect(stopped.notes).toBe('from Ana');
    expect(isRunningControlChange(bottle, stopped)).toBe(true);
  });

  it('cannot use someone else’s nursing session, and is told who started it', async () => {
    await seedNow(db, { role: 'Caregiver' });
    await seedMorning(db);
    await putEvent(
      db,
      'feeding',
      8,
      null,
      { method: 'breast', side: 'left', side_since: minutesAgo(8) },
      { createdBy: 'u-ana' },
    );
    await renderNow();
    const card = await screen.findByRole('region', { name: /nursing/i });
    expect(
      (within(card).getByRole('button', { name: /^Finish/ }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      within(card).getByText('Started by Ana. Only they or a parent can change it.'),
    ).toBeTruthy();
  });

  it('logs a dose but is not offered to add a prescription', async () => {
    await seedNow(db, { role: 'Caregiver' });
    await seedMorning(db);
    await renderNow();
    fireEvent.click(await screen.findByRole('button', { name: /^Meds/ }));
    const tray = await screen.findByRole('dialog');
    expect(within(tray).getByRole('button', { name: /Colidis/ })).toBeTruthy();
    expect(within(tray).queryByRole('button', { name: 'Add prescription' })).toBeNull();
  });

  it('(a parent is offered to add one there)', async () => {
    await seedNow(db, { role: 'Parent' });
    await seedMorning(db);
    await renderNow({ ...BABY, role: 'Parent' });
    fireEvent.click(await screen.findByRole('button', { name: /^Meds/ }));
    const tray = await screen.findByRole('dialog');
    expect(within(tray).getByRole('button', { name: 'Add prescription' })).toBeTruthy();
  });
});
