import { fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BabyRoutineDb } from '../../db/database';
import type { BabyRole } from '../../db/models';
import { byParts } from '../../medications/prescriptionFixtures';
import type { PredictionsDto } from '../../sync/contract';
import { fakeApi, testDatabase } from '../../test/fakeApi';
import { renderWithDb, settleSync } from '../../test/renderApp';
import {
  BABY,
  minutesAgo,
  nowApi,
  pinClock,
  putEvent,
  seedMorning,
  seedNow,
  sleepPredictions,
} from './nowKit';
import { NowScreen } from './NowScreen';

/*
 * "Next up" on the Now state card: the ring (and ruler) read the estimates from the local events,
 * the cached predictions and the prescriptions on the device; nothing new is fetched or sent, and
 * every role that sees the ring sees the same read-only markers and list.
 */

let db: BabyRoutineDb;

beforeEach(() => {
  db = testDatabase();
  window.localStorage.clear();
  window.localStorage.setItem('baby-routine.now-ring-open', 'open');
  window.localStorage.setItem('baby-routine.now-view', 'ring');
});

afterEach(async () => {
  vi.useRealTimers();
  await settleSync();
  await db.delete();
});

/** The sleep window opens in 40 min; the next feed is expected in `feedInMin` minutes. */
function predictions(feedInMin: number): PredictionsDto {
  const base = sleepPredictions(40);
  return {
    ...base,
    predictions: [
      ...base.predictions,
      {
        typeKey: 'feeding',
        confidence: 'Medium',
        sampleCount: 30,
        reason: '',
        expectedDuration: null,
        nextStart: {
          earliest: minutesAgo(-feedInMin + 20),
          expected: minutesAgo(-feedInMin),
          latest: minutesAgo(-feedInMin - 20),
        },
        basis: { kind: 'StartInterval', medianGapMinutes: 180, lookBackDays: 7 },
      },
    ],
  };
}

async function renderNow(feedInMin: number, role: BabyRole = 'Owner') {
  await seedNow(db, { role });
  await seedMorning(db, 60);
  const { api } = fakeApi(nowApi(predictions(feedInMin)));
  return renderWithDb(db, <NowScreen baby={{ ...BABY, role }} />, { api });
}

describe('next up on Now', () => {
  it('shows the next feed on the ring and in the list, from the cached prediction', async () => {
    pinClock(14, 0);
    await renderNow(60);
    const ring = await screen.findByTestId('day-ring');
    expect(await within(ring).findByTestId('ring-upcoming-feed')).toBeTruthy();
    const list = within(ring).getByRole('list', { name: 'Next up' });
    expect(within(list).getByTestId('upcoming-row-feed').textContent).toMatch(
      /^15:00Next bottle about 15:00 \(estimate\)Likely between 14:40 and 15:20 · /,
    );
  });

  it('adds a scheduled medicine with the Medicine chip, from the prescription', async () => {
    pinClock(14, 0);
    await db.prescriptions.put(byParts('m-colidis', ['evening']));
    await renderNow(60);
    const ring = await screen.findByTestId('day-ring');
    await within(ring).findByTestId('ring-upcoming-feed');
    fireEvent.click(within(ring).getByRole('button', { name: /^Show Medicine/ }));
    const row = await within(ring).findByTestId('upcoming-row-medicine');
    expect(row.textContent).toMatch(
      /^18:00Colidis in the evening(Any time from 18:00 to 22:00 · )?From the prescription$/,
    );
  });

  for (const role of ['Viewer', 'Caregiver'] as const) {
    it(`shows a ${role} the same read-only markers and list`, async () => {
      pinClock(14, 0);
      await renderNow(60, role);
      const ring = await screen.findByTestId('day-ring');
      expect(await within(ring).findByTestId('ring-upcoming-feed')).toBeTruthy();
      expect(within(ring).getByTestId('upcoming-row-feed')).toBeTruthy();
    });
  }

  it('keeps to today: nothing past midnight', async () => {
    pinClock(23, 30);
    await renderNow(60);
    const ring = await screen.findByTestId('day-ring');
    expect(await within(ring).findByTestId('upcoming-nothing')).toBeTruthy();
    expect(within(ring).queryByTestId('ring-upcoming-feed')).toBeNull();
  });

  it('drops the predicted feed once a bottle is logged inside its window', async () => {
    pinClock(14, 0);
    await putEvent(db, 'feeding', 0, 0, { method: 'bottle', amount_ml: 120 });
    await renderNow(10);
    const ring = await screen.findByTestId('day-ring');
    // With one gap of her own no gap is guessed: the server basis gap after the new bottle.
    const row = await within(ring).findByTestId('upcoming-row-feed');
    expect(row.textContent).toMatch(/^17:00Next bottle about 17:00 \(estimate\)/);
  });
});
