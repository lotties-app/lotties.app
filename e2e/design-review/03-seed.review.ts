import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { API_URL } from '../playwright.config';
import { accessToken, apiGet, openApp } from '../support/app';
import { freshSession, onlyReviewBaby, readState, startKeeper, stopKeeper, writeState } from './lib';

/*
 * Seeds ~3 days of realistic SYNTHETIC events for the review baby only (no real child data):
 * feeds (breast/bottle), diapers, naps, night sleep + night wakings, bed time / woke up markers,
 * medication from two custom medications, belly pain, bath, tummy time, one pumping, and growth
 * measurements. Throttled to stay well under the API's 300 requests/minute per user.
 */

const TYPE = {
  feeding: 'e6428ccb-7061-4cf4-a5d0-67c89a396a5f',
  sleep: '5cbe3692-d4df-4d5f-85d6-2282d9733b35',
  diaper: '318d1395-e373-4d89-a3cd-cdd7ad5187ab',
  bath: '833cf001-7e12-4bc6-b7a5-7adabb174aa5',
  tummy: '543cbd04-e226-435c-9639-810ecd066056',
  medication: 'bd43d7fb-e12c-438a-852e-c710b41a7c76',
  belly: '07a1ea45-7ba6-4fe3-9e38-a335da9ea12c',
  pump: 'ddfdaa52-57ee-4d34-8129-a78262c2172c',
};

const OFFSET = '-03:00'; // America/Sao_Paulo (no DST)
const at = (day: string, hhmm: string) => new Date(`${day}T${hhmm}:00${OFFSET}`).toISOString();
const nextDay = (day: string) => {
  const d = new Date(`${day}T12:00:00${OFFSET}`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};
const shift = (hhmm: string, minutes: number) => {
  const [h, m] = hhmm.split(':').map(Number);
  const total = (h * 60 + m + minutes + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
};

interface Ev {
  typeId: string;
  startedAt: string;
  endedAt: string | null;
  payload: Record<string, unknown>;
  notes?: string | null;
}

async function put(page: Page, path: string, body: unknown): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    const response = await page.request.put(`${API_URL}${path}`, {
      headers: { Authorization: `Bearer ${await accessToken(page)}` },
      data: body,
    });
    if (response.status() === 429 && attempt < 6) {
      await page.waitForTimeout(20_000); // fixed one-minute window: wait it out
      continue;
    }
    expect(response.ok(), `PUT ${path} -> ${response.status()} ${await response.text()}`).toBe(true);
    await page.waitForTimeout(450);
    return;
  }
}

test('seed synthetic events for the review baby', async ({ browser }) => {
  const state = readState();
  if (!state.babyId) throw new Error('Run 01-create first.');
  if (state.eventIds?.length) {
    console.log('already seeded', state.eventIds.length);
    return;
  }
  const babyId = state.babyId;
  await startKeeper(browser);
  const context = await browser.newContext({ storageState: await freshSession() });
  await onlyReviewBaby(context, babyId);
  const page = await context.newPage();
  await openApp(page);

  const babies = await apiGet<{ id: string }[]>(page, '/api/v1/babies');
  console.log('babies followed by the e2e account:', babies.length);
  // Reuse medications from an interrupted earlier attempt instead of duplicating them.
  const existing = await apiGet<{ id: string; name: string }[]>(page, `/api/v1/babies/${babyId}/medications`);
  const vitD = existing.find((m) => m.name === 'Vitamin D drops')?.id ?? randomUUID();
  const sime = existing.find((m) => m.name === 'Simethicone')?.id ?? randomUUID();
  await put(page, `/api/v1/babies/${babyId}/medications/${vitD}`, {
    name: 'Vitamin D drops',
    defaultDosage: { amount: 2, unit: 'drops' },
    notes: 'Once a day, morning',
    isUsual: true,
  });
  await put(page, `/api/v1/babies/${babyId}/medications/${sime}`, {
    name: 'Simethicone',
    defaultDosage: { amount: 0.3, unit: 'ml' },
    notes: null,
    isUsual: false,
  });

  const events: Ev[] = [];
  const add = (e: Ev) => events.push(e);
  const sleep = (kind: string, start: string, end: string | null) =>
    add({ typeId: TYPE.sleep, startedAt: start, endedAt: end, payload: { kind } });

  const days = ['2026-10-18', '2026-10-19', '2026-10-20'];
  // Night before the first day.
  sleep('night', at('2026-10-17', '20:45'), at('2026-10-18', '06:40'));

  days.forEach((day, i) => {
    const j = [0, 6, -4][i]; // small daily variation (minutes)
    const T = (hhmm: string, extra = 0) => at(day, shift(hhmm, j + extra));
    sleep('woke_up', T('06:40'), T('06:40'));
    add({
      typeId: TYPE.feeding,
      startedAt: T('06:50'),
      endedAt: T('07:08'),
      payload: { method: 'breast', side: 'left', breast_left_seconds: 600, breast_right_seconds: 480 },
    });
    add({ typeId: TYPE.diaper, startedAt: T('07:15'), endedAt: T('07:15'), payload: { content: 'WET' } });
    sleep('nap', T('08:20'), T('09:30'));
    add({
      typeId: TYPE.feeding,
      startedAt: T('09:40'),
      endedAt: T('09:55'),
      payload: { method: 'bottle', amount_ml: 120, bottle_feeding_type: 'formula' },
    });
    add({
      typeId: TYPE.medication,
      startedAt: T('09:58'),
      endedAt: T('09:58'),
      payload: { medications: [{ medicationId: vitD, name: 'Vitamin D drops', dose: { amount: 2, unit: 'drops' } }] },
    });
    add({ typeId: TYPE.tummy, startedAt: T('10:20'), endedAt: T('10:32'), payload: { mood: 'Happy' } });
    add({ typeId: TYPE.diaper, startedAt: T('10:45'), endedAt: T('10:45'), payload: { content: 'DIRTY' } });
    if (i === 2) {
      add({ typeId: TYPE.pump, startedAt: T('11:00'), endedAt: T('11:15'), payload: { amount_left_ml: 60, amount_right_ml: 45 } });
    }
    sleep('nap', T('11:35'), T('12:25'));
    add({
      typeId: TYPE.feeding,
      startedAt: T('12:35'),
      endedAt: T('12:55'),
      payload: { method: 'breast', side: 'both', breast_left_seconds: 540, breast_right_seconds: 600 },
    });
    add({ typeId: TYPE.diaper, startedAt: T('13:10'), endedAt: T('13:10'), payload: { content: 'WET' } });
    add({
      typeId: TYPE.sleep,
      startedAt: T('14:15'),
      endedAt: T('15:25'),
      payload: { kind: 'nap' },
      notes: i === 2 ? 'Fell asleep in the stroller on the way back from the park' : null,
    });
    add({
      typeId: TYPE.feeding,
      startedAt: T('15:35'),
      endedAt: T('15:50'),
      payload: { method: 'bottle', amount_ml: 150, bottle_feeding_type: 'breast_milk' },
    });
    if (i >= 1) {
      add({
        typeId: TYPE.belly,
        startedAt: T(i === 1 ? '17:05' : '16:00'),
        endedAt: T(i === 1 ? '17:05' : '16:00'),
        payload: { intensity: i === 1 ? 3 : 4 },
        notes: i === 1 ? 'Fussy after the feed, calmer after a tummy massage' : null,
      });
      add({
        typeId: TYPE.medication,
        startedAt: T(i === 1 ? '17:10' : '16:05'),
        endedAt: T(i === 1 ? '17:10' : '16:05'),
        payload: { medications: [{ medicationId: sime, name: 'Simethicone', dose: { amount: 0.3, unit: 'ml' } }] },
      });
    }
    add({ typeId: TYPE.tummy, startedAt: T('16:20'), endedAt: T('16:30'), payload: {} });
    add({ typeId: TYPE.diaper, startedAt: T('16:40'), endedAt: T('16:40'), payload: { content: 'MIXED' } });
    sleep('nap', T('17:15'), T('17:50'));
    add({
      typeId: TYPE.feeding,
      startedAt: T('18:20'),
      endedAt: T('18:40'),
      payload: { method: 'breast', side: 'right', breast_right_seconds: 780 },
    });
    add({ typeId: TYPE.bath, startedAt: T('19:00'), endedAt: T('19:00'), payload: { temperature_c: 37 } });
    add({ typeId: TYPE.diaper, startedAt: T('19:30'), endedAt: T('19:30'), payload: { content: 'WET' } });
    sleep('bed_time', T('20:15'), T('20:15'));
    add({
      typeId: TYPE.feeding,
      startedAt: T('20:20'),
      endedAt: T('20:35'),
      payload: { method: 'bottle', amount_ml: 120, bottle_feeding_type: 'formula' },
    });
    // Night: sleep, a waking with a feed and a change, then back to sleep.
    const n = nextDay(day);
    sleep('night', T('20:45'), at(n, shift('00:20', j)));
    sleep('night_waking', at(n, shift('00:20', j)), at(n, shift('00:45', j)));
    add({
      typeId: TYPE.feeding,
      startedAt: at(n, shift('00:25', j)),
      endedAt: at(n, shift('00:42', j)),
      payload: { method: 'breast', side: 'right', breast_left_seconds: 480, breast_right_seconds: 420 },
    });
    add({ typeId: TYPE.diaper, startedAt: at(n, shift('00:45', j)), endedAt: at(n, shift('00:45', j)), payload: { content: 'WET' } });
    if (i < 2) {
      // The last night stays open: the review creates that one as a running timer later.
      sleep('night', at(n, shift('00:50', j)), at(n, shift('06:40', j + [6, -4, 0][i] - j)));
    }
  });

  const ids: string[] = [];
  for (const e of events) {
    const id = randomUUID();
    await put(page, `/api/v1/babies/${babyId}/events/${id}`, {
      typeId: e.typeId,
      startedAt: e.startedAt,
      endedAt: e.endedAt,
      payload: e.payload,
      notes: e.notes ?? null,
      updatedAt: new Date().toISOString(),
    });
    ids.push(id);
  }

  const measurements = [
    { date: '2026-08-10', weightKg: 3.3, heightCm: 49, headCircumferenceCm: 34, notes: 'Birth' },
    { date: '2026-08-24', weightKg: 3.85, heightCm: 51, headCircumferenceCm: 35.2, notes: null },
    { date: '2026-09-10', weightKg: 4.6, heightCm: 54, headCircumferenceCm: 36.8, notes: null },
    { date: '2026-10-05', weightKg: 5.4, heightCm: 57, headCircumferenceCm: 38.4, notes: null },
    { date: '2026-10-19', weightKg: 5.75, heightCm: null, headCircumferenceCm: null, notes: 'Pediatrician visit' },
  ];
  const measurementIds: string[] = [];
  for (const m of measurements) {
    const id = randomUUID();
    await put(page, `/api/v1/babies/${babyId}/measurements/${id}`, m);
    measurementIds.push(id);
  }

  writeState({ medicationIds: [vitD, sime], eventIds: ids, measurementIds });
  console.log(`seeded ${ids.length} events, 2 medications, ${measurementIds.length} measurements`);
  await context.close();
  await stopKeeper();
});
