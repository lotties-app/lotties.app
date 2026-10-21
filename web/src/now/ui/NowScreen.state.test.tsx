import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BabyRoutineDb } from '../../db/database';
import type { Baby } from '../../db/models';
import type { PredictionsDto } from '../../sync/contract';
import { fakeApi, testDatabase } from '../../test/fakeApi';
import { renderWithDb, settleSync } from '../../test/renderApp';
import {
  BABY,
  holdToast,
  learningPredictions,
  minutesAgo,
  nowApi,
  putEvent,
  seedMorning,
  seedNow,
  sleepPredictions,
} from './nowKit';
import { NowScreen } from './NowScreen';

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

function renderNow(options: { predictions?: PredictionsDto | null; baby?: Baby } = {}) {
  const { api } = fakeApi(nowApi(options.predictions ?? null));
  return renderWithDb(db, <NowScreen baby={options.baby ?? BABY} />, { api });
}

/** Pins the clock (Date only: timers and IndexedDB keep running) to today at `hours:minutes`. */
function setClock(hours: number, minutes = 0) {
  vi.useFakeTimers({ toFake: ['Date'] });
  const now = new Date();
  vi.setSystemTime(new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes));
}

const duration = () => screen.findByTestId('state-duration');
const allEvents = () => db.events.toArray();

describe('state card, awake', () => {
  it('shows the live duration, the nap window on the day ruler and the confidence', async () => {
    await seedNow(db);
    await seedMorning(db, 112);
    renderNow({ predictions: sleepPredictions(-5) });

    expect((await duration()).textContent).toBe('1h 52m');
    expect(screen.getByText('Awake')).toBeTruthy();
    expect(screen.getByText(/after a nap/)).toBeTruthy();
    expect(await screen.findByText('Nap window')).toBeTruthy();
    expect(screen.getByText(/open now/)).toBeTruthy();
    expect(screen.getByText('Medium confidence')).toBeTruthy();
    // The ruler is an image with a text equivalent and an ink line, a band and a now mark.
    const ruler = screen.getByRole('img', {
      name: /^Awake since \d\d:\d\d, now \d\d:\d\d\. Nap window/,
    });
    expect(within(ruler).getByTestId('ruler-window')).toBeTruthy();
    expect(within(ruler).getByTestId('ruler-awake')).toBeTruthy();
    expect(within(ruler).getByTestId('ruler-now')).toBeTruthy();
  });

  it('says when the window opens, before it does', async () => {
    await seedNow(db);
    await seedMorning(db, 60);
    renderNow({ predictions: sleepPredictions(30) });
    expect(await screen.findByText(/opens in (29|30)m/)).toBeTruthy();
  });

  it('"Why?" opens a sheet with the sentence built from the basis and the disclaimer', async () => {
    await seedNow(db);
    await seedMorning(db, 112);
    renderNow({ predictions: sleepPredictions(-5) });

    fireEvent.click(await screen.findByRole('button', { name: 'Why?' }));
    const sheet = await screen.findByRole('dialog', { name: 'Why this window?' });
    expect(
      within(sheet).getByText(/Usually 1h 45m awake after waking up, based on the last 7 days\./),
    ).toBeTruthy();
    expect(within(sheet).getByText(/18 samples used\./)).toBeTruthy();
    expect(within(sheet).getByText(/not medical advice/)).toBeTruthy();

    fireEvent.click(within(sheet).getByRole('button', { name: 'Close' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Why this window?' })).toBeNull(),
    );
  });

  it('shows a learning state with progress instead of an empty prediction', async () => {
    await seedNow(db);
    await seedMorning(db, 40);
    renderNow({ predictions: learningPredictions() });

    expect(await screen.findByText("Learning Lia's rhythm")).toBeTruthy();
    expect(screen.getByText('Log a few days and predictions appear here.')).toBeTruthy();
    const bar = await screen.findByRole('progressbar', { name: '1 of 3 sleeps logged' });
    expect(bar.getAttribute('aria-valuenow')).toBe('33');
    expect(screen.queryByText('Nap window')).toBeNull();
  });

  it('shows the learning text when the server sent no prediction at all', async () => {
    await seedNow(db);
    await seedMorning(db, 40);
    renderNow();
    expect(await screen.findByText("Learning Lia's rhythm")).toBeTruthy();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });
});

describe('the sleep toggle', () => {
  it('Asleep starts a nap, shows the toast, flips the card, and Undo reverts it', async () => {
    setClock(14, 12);
    await seedNow(db);
    await seedMorning(db, 112);
    renderNow({ predictions: sleepPredictions(-5) });

    fireEvent.click(await screen.findByRole('button', { name: 'Fell asleep' }));

    await holdToast();
    expect(await screen.findByText('Nap from 14:12')).toBeTruthy();
    expect(await screen.findByText('Asleep · Nap')).toBeTruthy();
    expect(await screen.findByRole('button', { name: 'Woke up' })).toBeTruthy();
    const created = (await allEvents()).filter(
      (e) => e.payload.kind === 'nap' && e.endedAt === null,
    );
    expect(created).toHaveLength(1);
    expect(
      (await allEvents()).some((e) => e.payload.kind === 'fell_asleep' && e.deletedAt === null),
    ).toBe(true);
    expect((await duration()).textContent).toBe('0m');

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(async () =>
      expect((await allEvents()).filter((e) => e.deletedAt === null && e.endedAt === null)).toEqual(
        [],
      ),
    );
    expect(await screen.findByRole('button', { name: 'Fell asleep' })).toBeTruthy();
  });

  it('the toast time chips move the sleep back ("she fell asleep 10 minutes ago")', async () => {
    setClock(14, 12);
    await seedNow(db);
    await seedMorning(db, 112);
    renderNow();

    fireEvent.click(await screen.findByRole('button', { name: 'Fell asleep' }));
    await holdToast();
    const group = await screen.findByRole('group', { name: 'When it happened' });
    expect(within(group).getByRole('button', { name: 'Now' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    fireEvent.click(within(group).getByRole('button', { name: '−10 min' }));

    expect(await screen.findByText('Nap from 14:02')).toBeTruthy();
    const timer = (await allEvents()).find((e) => e.payload.kind === 'nap' && e.endedAt === null);
    expect(new Date(timer!.startedAt).getMinutes()).toBe(2);
    expect(
      within(screen.getByRole('group', { name: 'When it happened' }))
        .getByRole('button', { name: '−10 min' })
        .getAttribute('aria-pressed'),
    ).toBe('true');
  });

  it('Woke up ends the nap and logs the wake-up marker', async () => {
    setClock(14, 12);
    await seedNow(db);
    await seedMorning(db, 400);
    const nap = await putEvent(db, 'sleep', 42, null, { kind: 'nap' });
    renderNow();

    expect((await duration()).textContent).toBe('42m');
    fireEvent.click(await screen.findByRole('button', { name: 'Woke up' }));

    expect(await screen.findByText('Woke up at 14:12')).toBeTruthy();
    await waitFor(async () => expect((await db.events.get(nap.id))?.endedAt).not.toBeNull());
    expect((await allEvents()).some((e) => e.payload.kind === 'woke_up')).toBe(true);
    expect(await screen.findByRole('button', { name: 'Fell asleep' })).toBeTruthy();
  });

  it('at night, Night waking leads, and Back asleep ends the waking and keeps the night', async () => {
    setClock(3, 10);
    await seedNow(db);
    await seedMorning(db, 700);
    const night = await putEvent(db, 'sleep', 252, null, { kind: 'night' });
    renderNow();

    expect(await screen.findByText('Asleep · Night')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Up for the day' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Night waking' }));

    expect(await screen.findByText('Night waking from 03:10')).toBeTruthy();
    expect(await screen.findByRole('button', { name: 'Back asleep' })).toBeTruthy();
    const waking = (await allEvents()).find((e) => e.payload.kind === 'night_waking');
    expect(waking?.endedAt).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Back asleep' }));
    await waitFor(async () => expect((await db.events.get(waking!.id))?.endedAt).not.toBeNull());
    expect((await db.events.get(night.id))?.endedAt).toBeNull();
    expect(await screen.findByRole('button', { name: 'Night waking' })).toBeTruthy();
  });

  it('"Up for the day" at night ends the sleep and every waking', async () => {
    setClock(5, 40);
    await seedNow(db);
    await seedMorning(db, 700);
    const night = await putEvent(db, 'sleep', 540, null, { kind: 'night' });
    await putEvent(db, 'sleep', 4, null, { kind: 'night_waking' });
    renderNow();

    fireEvent.click(await screen.findByRole('button', { name: 'Up for the day' }));
    await waitFor(async () => expect((await db.events.get(night.id))?.endedAt).not.toBeNull());
    await waitFor(async () =>
      expect((await allEvents()).filter((e) => e.deletedAt === null && e.endedAt === null)).toEqual(
        [],
      ),
    );
  });

  it('Bedtime is a quiet secondary action that logs the marker', async () => {
    setClock(19, 30);
    await seedNow(db);
    await seedMorning(db, 150);
    renderNow();

    fireEvent.click(await screen.findByRole('button', { name: 'Bedtime' }));
    expect(await screen.findByText('Bedtime at 19:30')).toBeTruthy();
    expect((await allEvents()).some((e) => e.payload.kind === 'bed_time')).toBe(true);
  });

  it('without any sleep event it asks what the baby is doing, and Awake sets the state', async () => {
    await seedNow(db);
    await putEvent(db, 'diaper', 30, 30, { content: 'WET' });
    renderNow();

    expect(await screen.findByRole('heading', { name: 'What is Lia doing now?' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sleeping' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Awake' }));

    expect(await screen.findByText(/^Woke up at/)).toBeTruthy();
    expect((await duration()).textContent).toBe('0m');
  });
});

describe('nursing, left and right', () => {
  it('shows a timer per side, switches side by tap and with Switch side, and Finish saves the seconds', async () => {
    await seedNow(db);
    await seedMorning(db, 95);
    const nursing = await putEvent(db, 'feeding', 6, null, {
      method: 'breast',
      side: 'right',
      breast_left_seconds: 190,
      side_since: minutesAgo(3),
    });
    renderNow();

    const region = await screen.findByRole('region', { name: 'Nursing' });
    expect(within(region).getByTestId('nursing-left').textContent).toBe('03:10');
    expect(within(region).getByTestId('nursing-right').textContent).toMatch(/^03:0\d$/);
    expect(
      within(region)
        .getByRole('button', { name: /^Right/ })
        .getAttribute('aria-pressed'),
    ).toBe('true');
    expect(within(region).getByText('running')).toBeTruthy();
    // The nursing session has its own card, not a second row in the timers.
    expect(screen.queryByRole('region', { name: 'Running timers' })).toBeNull();

    fireEvent.click(within(region).getByRole('button', { name: /^Left/ }));
    await holdToast();
    expect(await screen.findByText('Switched to the left')).toBeTruthy();
    await waitFor(async () => expect((await db.events.get(nursing.id))?.payload.side).toBe('left'));
    expect((await db.events.get(nursing.id))?.payload.breast_right_seconds).toBeGreaterThanOrEqual(
      180,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Switch side' }));
    await waitFor(async () =>
      expect((await db.events.get(nursing.id))?.payload.side).toBe('right'),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Finish' }));
    await waitFor(async () => expect((await db.events.get(nursing.id))?.endedAt).not.toBeNull());
    const done = await db.events.get(nursing.id);
    expect(done?.payload).toMatchObject({ method: 'breast', side: 'both', last_side: 'right' });
    expect(await screen.findByText(/^Nursing done, left 3m, right/)).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Nursing' })).toBeNull());
  });
});

describe('other timers and the forgotten-timer note', () => {
  it('lists a running timer with a live clock and a neutral Stop that ends it', async () => {
    await seedNow(db);
    await seedMorning(db, 95);
    const tummy = await putEvent(db, 'tummy_time', 5, null, {});
    renderNow();

    const region = await screen.findByRole('region', { name: 'Running timers' });
    expect(within(region).getByText('Tummy time')).toBeTruthy();
    expect(within(region).getByText(/^0[45]:\d\d$/)).toBeTruthy();
    fireEvent.click(within(region).getByRole('button', { name: 'Stop Tummy time' }));
    await waitFor(async () => expect((await db.events.get(tummy.id))?.endedAt).not.toBeNull());
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Running timers' })).toBeNull(),
    );
  });

  it('a timer far past its threshold offers "Stop at <time>", and Still going hides the note', async () => {
    await seedNow(db);
    await seedMorning(db, 95);
    const tummy = await putEvent(db, 'tummy_time', 7 * 60, null, {});
    renderNow();

    const note = await screen.findByRole('group', {
      name: /^Still running\? Tummy time has run for 7h/,
    });
    fireEvent.click(within(note).getByRole('button', { name: 'Still going' }));
    await waitFor(() =>
      expect(screen.queryByRole('group', { name: /^Still running\?/ })).toBeNull(),
    );
    expect((await db.events.get(tummy.id))?.endedAt).toBeNull();
  });

  it('Stop at <time> ends the forgotten timer at the suggested end, not now', async () => {
    await seedNow(db);
    await seedMorning(db, 95);
    const tummy = await putEvent(db, 'tummy_time', 7 * 60, null, {});
    renderNow();

    const stop = await screen.findByRole('button', { name: /^Stop at \d\d:\d\d$/ });
    fireEvent.click(stop);
    await waitFor(async () => expect((await db.events.get(tummy.id))?.endedAt).not.toBeNull());
    const ended = (await db.events.get(tummy.id))!;
    // The next activity after it started (a diaper or feed) or its typical length: well before now.
    expect(Date.parse(ended.endedAt!)).toBeLessThan(Date.now() - 60_000);
    expect(Date.parse(ended.endedAt!)).toBeGreaterThan(Date.parse(ended.startedAt));
  });

  it('a nap running for hours asks "Still asleep?" and offers the wake time', async () => {
    await seedNow(db);
    await seedMorning(db, 400);
    const nap = await putEvent(db, 'sleep', 5 * 60, null, { kind: 'nap' });
    renderNow();

    expect(await screen.findByText(/^Still asleep\? The nap has run for 5h/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^Woke up at \d\d:\d\d$/ }));
    await waitFor(async () => expect((await db.events.get(nap.id))?.endedAt).not.toBeNull());
    expect(Date.parse((await db.events.get(nap.id))!.endedAt!)).toBeLessThan(Date.now() - 60_000);
  });

  it('stopping a timer that lacks required fields asks for them first (no silent un-stop)', async () => {
    await seedNow(db);
    await seedMorning(db, 95);
    const feeding = await putEvent(db, 'feeding', 5, null, {});
    renderNow();

    fireEvent.click(await screen.findByRole('button', { name: 'Stop Feeding' }));
    expect(await screen.findByRole('heading', { name: 'Finish this feeding' })).toBeTruthy();
    expect((await db.events.get(feeding.id))?.endedAt).toBeNull();
  });
});
