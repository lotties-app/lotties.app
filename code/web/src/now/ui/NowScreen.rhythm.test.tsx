import { fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BabyRoutineDb } from '../../db/database';
import type { PredictionsDto } from '../../sync/contract';
import { fakeApi, testDatabase } from '../../test/fakeApi';
import { renderWithDb, settleSync } from '../../test/renderApp';
import { BABY, nowApi, pinClock, putEvent, seedMorning, seedNow, sleepPredictions } from './nowKit';
import { NowScreen } from './NowScreen';

/*
 * The state card wires the rhythm details: the face of now, the projected naps after the server's
 * window while awake (only with enough naps logged), and the likely wake-up while a nap runs.
 */

let db: BabyRoutineDb;

beforeEach(() => {
  db = testDatabase();
  window.localStorage.clear();
  window.localStorage.setItem('baby-routine.now-ring-open', 'open');
});

afterEach(async () => {
  vi.useRealTimers();
  await settleSync();
  await db.delete();
});

function renderNow(predictions: PredictionsDto | null = null) {
  const { api } = fakeApi(nowApi(predictions));
  return renderWithDb(db, <NowScreen baby={BABY} />, { api });
}

/** Naps on the two days before: three a day (07:00 and 12:00 for 1 h, 16:00 for 45 min). */
async function seedPastNaps() {
  for (const day of [1, 2]) {
    const ago = day * 24 * 60;
    await putEvent(db, 'sleep', ago + 120, ago + 60, { kind: 'nap' });
    await putEvent(db, 'sleep', ago - 180, ago - 240, { kind: 'nap' });
    await putEvent(db, 'sleep', ago - 420, ago - 465, { kind: 'nap' });
  }
}

describe('the rhythm details on Now', () => {
  beforeEach(() => pinClock(9, 0));

  it('draws the projected naps after the window on the ring, as estimates', async () => {
    await seedNow(db);
    await seedPastNaps();
    await seedMorning(db, 60);
    window.localStorage.setItem('baby-routine.now-view', 'ring');
    renderNow(sleepPredictions(40));
    const ring = await screen.findByTestId('day-ring');
    expect(await within(ring).findAllByTestId('ring-projected')).not.toHaveLength(0);
    const legend = within(ring).getByRole('list', { name: 'What the ring shows' });
    expect(within(legend).getByText('Next naps (estimate)')).toBeTruthy();
    const projected = within(ring).getAllByRole('button', { name: /\(estimate\)\./ });
    expect(projected[0].getAttribute('aria-label')).toMatch(
      /^Later nap window about \d\d:\d\d to \d\d:\d\d \(estimate\)\. Based on the usual awake time of about 1h 45m and naps of about 1h\.$/,
    );
    fireEvent.click(within(ring).getByTestId('rhythm-mark-now'));
    expect(screen.getByTestId('rhythm-detail').textContent).toMatch(
      /^Now, 09:00, awake · Awake for 1h/,
    );
  });

  it('shows only the server window with too few naps logged', async () => {
    await seedNow(db);
    await seedMorning(db, 60);
    window.localStorage.setItem('baby-routine.now-view', 'ring');
    renderNow(sleepPredictions(40));
    const ring = await screen.findByTestId('day-ring');
    expect(await within(ring).findAllByTestId('ring-window')).toHaveLength(1);
    expect(within(ring).queryByTestId('ring-projected')).toBeNull();
  });

  it('while a nap runs: the asleep face, the likely wake-up and the next window', async () => {
    await seedNow(db);
    await seedPastNaps();
    await seedMorning(db, 120);
    await putEvent(db, 'sleep', 20, null, { kind: 'nap' });
    renderNow(sleepPredictions(-30));
    const ring = await screen.findByTestId('day-ring');
    expect(within(ring).getByTestId('ring-now').getAttribute('data-face')).toBe('asleep');
    expect(await within(ring).findByTestId('ring-wake')).toBeTruthy();
    expect(
      within(ring).getByRole('button', { name: /^Likely to wake about \d\d:\d\d \(estimate\)\./ }),
    ).toBeTruthy();
    expect(within(ring).getByTestId('ring-window-line').textContent).toMatch(
      /^Next nap about \d\d:\d\d–\d\d:\d\d$/,
    );
  });
});
