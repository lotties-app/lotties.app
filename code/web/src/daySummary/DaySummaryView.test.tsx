import { fireEvent, screen, within } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BabyRoutineDb } from '../db/database';
import type { BabyEvent, EventPayload, EventType } from '../db/models';
import { activateLocale } from '../i18n/i18n';
import { BABY, NOW_TYPES } from '../now/ui/nowKit';
import {
  BREAST_PUMP_TYPE,
  DIAPER_TYPE,
  FEEDING_TYPE,
  FUSSY_TYPE,
  SLEEP_TYPE,
  TEMPERATURE_TYPE,
} from '../test/builtInTypes';
import { testDatabase } from '../test/fakeApi';
import { useTestLocale } from '../test/locale';
import { renderWithDb, settleSync } from '../test/renderApp';
import { setUnitSetting } from '../units/state';
import { DaySummaryView } from './DaySummaryView';

/*
 * The Day summary on a pinned clock (Wednesday 21 Oct 2026, 15:00 local): the cards of today with
 * their usual lines, the day navigator, the empty state, both languages and US units.
 */

let db: BabyRoutineDb;
let seq = 0;

const at = (back: number, hour: number, minute = 0) =>
  new Date(2026, 9, 21 - back, hour, minute).toISOString();

const MEDICATION_ID = NOW_TYPES.find((type) => type.key === 'medication')?.id as string;
const TYPES: EventType[] = [...NOW_TYPES, FUSSY_TYPE, TEMPERATURE_TYPE, BREAST_PUMP_TYPE];

function make(
  typeId: string,
  start: string,
  end: string | null,
  payload: EventPayload = {},
): BabyEvent {
  seq += 1;
  return {
    id: `day-${seq}`,
    babyId: BABY.id,
    typeId,
    startedAt: start,
    endedAt: end,
    payload,
    notes: seq % 2 ? 'private words' : null,
    createdBy: null,
    createdAt: start,
    updatedAt: start,
    deletedAt: null,
  };
}

/** One logged day `back` days ago; its events before 15:00 and some after. */
function loggedDay(back: number): BabyEvent[] {
  return [
    make(SLEEP_TYPE.id, at(back + 1, 20), at(back, 6), { kind: 'night' }),
    make(SLEEP_TYPE.id, at(back, 9), at(back, 10), { kind: 'nap' }),
    make(SLEEP_TYPE.id, at(back, 16), at(back, 17), { kind: 'nap' }),
    make(FEEDING_TYPE.id, at(back, 7), at(back, 7, 20), { method: 'bottle', amount_ml: 120 }),
    make(FEEDING_TYPE.id, at(back, 18), at(back, 18, 20), { method: 'bottle', amount_ml: 150 }),
    make(DIAPER_TYPE.id, at(back, 8), at(back, 8), { content: 'WET' }),
    make(DIAPER_TYPE.id, at(back, 19), at(back, 19), { content: 'DIRTY' }),
  ];
}

const TODAY_EVENTS = () => [
  make(SLEEP_TYPE.id, at(1, 20), at(0, 6), { kind: 'night' }),
  make(SLEEP_TYPE.id, at(0, 9), at(0, 10, 30), { kind: 'nap' }),
  make(SLEEP_TYPE.id, at(0, 12), at(0, 13), { kind: 'nap' }),
  make(FEEDING_TYPE.id, at(0, 7), at(0, 7, 20), {
    method: 'bottle',
    amount_ml: 120,
    amount_drunk_ml: 90,
  }),
  make(FEEDING_TYPE.id, at(0, 11), at(0, 11, 15), {
    method: 'breast',
    breast_left_seconds: 420,
    breast_right_seconds: 480,
  }),
  make(FEEDING_TYPE.id, at(0, 14), at(0, 14, 10), { method: 'bottle', amount_ml: 100 }),
  make(BREAST_PUMP_TYPE.id, at(0, 13, 30), at(0, 13, 45), { amount_left_ml: 80 }),
  make(DIAPER_TYPE.id, at(0, 8), at(0, 8), { content: 'WET' }),
  make(DIAPER_TYPE.id, at(0, 11, 30), at(0, 11, 30), { content: 'MIXED' }),
  make(FUSSY_TYPE.id, at(0, 10, 40), at(0, 10, 55)),
  make(TEMPERATURE_TYPE.id, at(0, 12, 30), at(0, 12, 30), { value_c: 37.4 }),
  make(MEDICATION_ID, at(0, 9, 5), at(0, 9, 5), {
    medications: [{ medicationId: 'm1', name: 'Hidden syrup', dose: { amount: 2.5, unit: 'ml' } }],
  }),
];

async function seed(events: BabyEvent[]) {
  await db.events.bulkPut(events);
}

const renderView = () => renderWithDb(db, <DaySummaryView baby={BABY} />);
const card = (name: string) =>
  document.querySelector(`[data-day-card="${name}"]`) as HTMLElement | null;
const cardOrder = () =>
  [...document.querySelectorAll('[data-day-card]')].map((node) =>
    node.getAttribute('data-day-card'),
  );

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 9, 21, 15, 0));
  setUnitSetting('metric');
  db = testDatabase();
  await db.babies.put(BABY);
  await db.eventTypes.bulkPut(TYPES);
});

afterEach(async () => {
  await settleSync();
  await db.delete();
  setUnitSetting('auto');
  await activateLocale('en');
  vi.useRealTimers();
});

describe('today', () => {
  it('sums up the day in order, with the usual by this time', async () => {
    await seed([...TODAY_EVENTS(), ...loggedDay(1), ...loggedDay(2), ...loggedDay(3)]);
    renderView();
    expect(await screen.findByRole('heading', { name: 'Today, up to 15:00' })).toBeTruthy();
    expect(cardOrder()).toEqual(['sleep', 'feeding', 'diapers', 'crying', 'health']);

    const sleep = within(card('sleep') as HTMLElement);
    expect(sleep.getByRole('heading', { name: 'Sleep' })).toBeTruthy();
    expect(sleep.getByText('12h 30m')).toBeTruthy();
    expect(sleep.getByText('Night 10h · 2 naps 2h 30m')).toBeTruthy();
    expect(sleep.getByText('Longest nap 1h 30m')).toBeTruthy();
    expect(sleep.getByText('Awake for 2h')).toBeTruthy();
    // Each of the three days before: the 10 h night and the 09:00 nap by 15:00.
    expect(sleep.getByText('Usual by this time: 11h (average of 3 days)')).toBeTruthy();

    const feeding = within(card('feeding') as HTMLElement);
    expect(feeding.getByText('190 ml drunk')).toBeTruthy();
    expect(feeding.getByText('of 220 ml prepared · 30 ml not drunk')).toBeTruthy();
    // Pumping is not a feed.
    expect(feeding.getByText('3 feeds')).toBeTruthy();
    expect(feeding.getByText('Breast 15m (left 7m, right 8m)')).toBeTruthy();
    expect(feeding.getByText('Last feed at 14:00')).toBeTruthy();
    expect(feeding.getByText('Usual by this time: 120 ml (average of 3 days)')).toBeTruthy();

    const diapers = within(card('diapers') as HTMLElement);
    expect(diapers.getByText('2 diapers')).toBeTruthy();
    expect(diapers.getByText('2 wet · 1 dirty')).toBeTruthy();
    expect(diapers.getByText('A mixed diaper counts as both wet and dirty.')).toBeTruthy();
    expect(diapers.getByText('Usual by this time: 1 diaper (average of 3 days)')).toBeTruthy();

    const crying = within(card('crying') as HTMLElement);
    expect(crying.getByText('1 spell')).toBeTruthy();
    expect(crying.getByText('15m in total')).toBeTruthy();
    // No crying was logged on the days before: no usual line.
    expect(crying.queryByText(/Usual/)).toBeNull();

    const health = within(card('health') as HTMLElement);
    expect(health.getByText('Temperature 37.4 °C at 12:30')).toBeTruthy();
    expect(health.getByText('1 medication dose logged')).toBeTruthy();
    expect(health.queryByText(/Breast pump/)).toBeNull();
    expect(screen.queryByText(/Hidden syrup|2\.5|private words/)).toBeNull();
    expect(
      screen.getByText('Calculated on this device from what was logged. Not medical advice.'),
    ).toBeTruthy();
  });

  it('hides a usual line under three recorded days and cards with nothing logged', async () => {
    await seed([
      make(DIAPER_TYPE.id, at(0, 9), at(0, 9), { content: 'WET' }),
      ...loggedDay(1),
      ...loggedDay(2),
    ]);
    renderView();
    expect(await screen.findByText('1 diaper')).toBeTruthy();
    expect(cardOrder()).toEqual(['diapers']);
    expect(screen.queryByText(/Usual/)).toBeNull();
  });

  it('shows the calm empty state when nothing was logged today', async () => {
    await seed(loggedDay(1));
    renderView();
    expect(await screen.findByRole('heading', { name: 'Nothing logged yet today' })).toBeTruthy();
    expect(cardOrder()).toEqual([]);
  });

  it('has no accessibility violations', async () => {
    await seed([...TODAY_EVENTS(), ...loggedDay(1), ...loggedDay(2), ...loggedDay(3)]);
    renderView();
    await screen.findByText('190 ml drunk');
    const result = await axe.run(document.body, {
      runOnly: ['wcag2a', 'wcag2aa'],
      rules: { 'color-contrast': { enabled: false } },
    });
    expect(result.violations.map((v) => v.id)).toEqual([]);
  });
});

describe('breast time', () => {
  it('shows the time without a side as its own part, the parts adding up to the total', async () => {
    await seed([
      // 20.6 + 7.6 minutes timed per side in a 30-minute feed: 1.8 minutes without a side.
      make(FEEDING_TYPE.id, at(0, 8), at(0, 8, 30), {
        method: 'breast',
        breast_left_seconds: 1236,
        breast_right_seconds: 456,
      }),
      // A feed logged without side times.
      make(FEEDING_TYPE.id, at(0, 12), at(0, 12, 5), { method: 'breast' }),
    ]);
    renderView();
    expect(
      await screen.findByText('Breast 35m (left 21m, right 7m, side not recorded 7m)'),
    ).toBeTruthy();
  });

  it('shows only the total when no side was timed', async () => {
    await useTestLocale('pt-BR');
    await seed([make(FEEDING_TYPE.id, at(0, 12), at(0, 12, 25), { method: 'breast' })]);
    renderView();
    expect(await screen.findByText('Peito 25 min')).toBeTruthy();
  });

  it('names the part without a side in Portuguese', async () => {
    await useTestLocale('pt-BR');
    await seed([
      make(FEEDING_TYPE.id, at(0, 8), at(0, 8, 20), {
        method: 'breast',
        breast_left_seconds: 600,
      }),
    ]);
    renderView();
    expect(
      await screen.findByText('Peito 20 min (esquerdo 10 min e sem lado informado 10 min)'),
    ).toBeTruthy();
  });
});

describe('the day navigator', () => {
  it('goes back to yesterday, measured whole, and stops at the first logged day', async () => {
    await seed([...TODAY_EVENTS(), ...loggedDay(1), ...loggedDay(2)]);
    renderView();
    const next = await screen.findByRole('button', { name: 'Next day' });
    expect(next.hasAttribute('disabled')).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Previous day' }));
    expect(await screen.findByRole('heading', { name: 'Yesterday' })).toBeTruthy();
    const sleep = within(card('sleep') as HTMLElement);
    expect(sleep.getByText('12h')).toBeTruthy();
    expect(sleep.queryByText(/Awake for/)).toBeNull();
    expect(within(card('feeding') as HTMLElement).getByText('270 ml drunk')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Previous day' }));
    expect(await screen.findByRole('heading', { name: 'Monday, October 19' })).toBeTruthy();
    // The first logged day is the 18th (the night before the 19th started then).
    fireEvent.click(screen.getByRole('button', { name: 'Previous day' }));
    expect(await screen.findByRole('heading', { name: 'Sunday, October 18' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Previous day' }).hasAttribute('disabled')).toBe(
      true,
    );
    expect(screen.getByRole('heading', { name: 'Nothing logged on this day' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Next day' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next day' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next day' }));
    expect(await screen.findByRole('heading', { name: 'Today, up to 15:00' })).toBeTruthy();
  });

  it('says usual per day on a past day', async () => {
    await seed([...loggedDay(1), ...loggedDay(2), ...loggedDay(3), ...loggedDay(4)]);
    renderView();
    fireEvent.click(await screen.findByRole('button', { name: 'Previous day' }));
    expect(await screen.findByText('Usual per day: 2 diapers (average of 3 days)')).toBeTruthy();
  });
});

describe('language and units', () => {
  it('speaks Portuguese without assuming the baby is a boy or a girl', async () => {
    await useTestLocale('pt-BR');
    await seed([...TODAY_EVENTS(), ...loggedDay(1), ...loggedDay(2), ...loggedDay(3)]);
    renderView();
    expect(await screen.findByRole('heading', { name: 'Hoje, até 15:00' })).toBeTruthy();
    expect(screen.getByText('Tempo acordado: 2 h')).toBeTruthy();
    expect(screen.getByText('Noite 10 h · 2 sonecas 2 h 30 min')).toBeTruthy();
    expect(screen.getByText('190 ml bebidos')).toBeTruthy();
    expect(screen.getByText('3 mamadas')).toBeTruthy();
    expect(screen.getByText('2 com xixi · 1 com cocô')).toBeTruthy();
    expect(screen.getByText('Temperatura 37,4 °C às 12:30')).toBeTruthy();
    expect(screen.getByText('De costume até esta hora: 11 h (média de 3 dias)')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Dia anterior' })).toBeTruthy();
  });

  it('shows fluid ounces and Fahrenheit in US units, the numbers adding up as shown', async () => {
    setUnitSetting('us');
    await seed(TODAY_EVENTS());
    renderView();
    await screen.findByRole('heading', { name: 'Feeding' });
    const feeding = within(card('feeding') as HTMLElement);
    expect(feeding.getByText('6.4 fl oz drunk')).toBeTruthy();
    expect(feeding.getByText('of 7.4 fl oz prepared · 1 fl oz not drunk')).toBeTruthy();
    expect(screen.getByText('Temperature 99.3 °F at 12:30')).toBeTruthy();
  });
});
