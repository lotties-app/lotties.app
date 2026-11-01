import { fireEvent, screen, within } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BabyRoutineDb } from '../db/database';
import type { BabyEvent, EventPayload } from '../db/models';
import { BABY, NOW_TYPES } from '../now/ui/nowKit';
import { DIAPER_TYPE, FEEDING_TYPE, SLEEP_TYPE } from '../test/builtInTypes';
import { testDatabase } from '../test/fakeApi';
import { useTestLocale } from '../test/locale';
import { renderWithDb, settleSync } from '../test/renderApp';
import { InsightsSection } from './InsightsSection';

/*
 * The Insights section on a pinned clock (21 Oct 2026, 15:00 local): the progress rows while
 * nothing is open, the cards once days with data are there, the table view and the range switch.
 */

let db: BabyRoutineDb;
let seq = 0;

const at = (back: number, hour: number, minute = 0) =>
  new Date(2026, 9, 21 - back, hour, minute).toISOString();

function make(typeId: string, start: string, end: string, payload: EventPayload): BabyEvent {
  seq += 1;
  return {
    id: `ins-${seq}`,
    babyId: BABY.id,
    typeId,
    startedAt: start,
    endedAt: end,
    payload,
    notes: null,
    createdBy: null,
    createdAt: start,
    updatedAt: start,
    deletedAt: null,
  };
}

/** `count` logged days ending `from` days ago: a nap, a night, four feeds, two diapers each. */
async function seedDays(count: number, from = 1) {
  const events: BabyEvent[] = [];
  for (let back = from; back < from + count; back++) {
    events.push(
      make(SLEEP_TYPE.id, at(back, 13), at(back, 14), { kind: 'nap' }),
      make(SLEEP_TYPE.id, at(back, 20), at(back - 1, 6), { kind: 'night' }),
      make(FEEDING_TYPE.id, at(back, 7), at(back, 7, 20), { method: 'breast' }),
      make(FEEDING_TYPE.id, at(back, 10), at(back, 10, 15), {
        method: 'bottle',
        amount_ml: 120,
        bottle_feeding_type: 'formula',
      }),
      make(FEEDING_TYPE.id, at(back, 13), at(back, 13, 20), { method: 'breast' }),
      make(FEEDING_TYPE.id, at(back, 16), at(back, 16, 20), { method: 'breast' }),
      make(DIAPER_TYPE.id, at(back, 8), at(back, 8), { content: 'WET' }),
      make(DIAPER_TYPE.id, at(back, 12), at(back, 12), { content: 'MIXED' }),
    );
  }
  await db.events.bulkPut(events);
}

function renderSection() {
  return renderWithDb(db, <InsightsSection baby={BABY} />);
}

async function axeViolations() {
  const result = await axe.run(document.body, {
    runOnly: ['wcag2a', 'wcag2aa'],
    // jsdom has no layout: contrast is covered by the token tests and the screenshots.
    rules: { 'color-contrast': { enabled: false } },
  });
  return result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(' | ')}`);
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 9, 21, 15, 0));
  db = testDatabase();
  await db.babies.put(BABY);
  await db.eventTypes.bulkPut(NOW_TYPES);
});

afterEach(async () => {
  await settleSync();
  await db.delete();
  vi.useRealTimers();
});

describe('while nothing is open', () => {
  it('lists every insight with its progress and an estimate', async () => {
    await seedDays(2);
    renderSection();
    expect(await screen.findByRole('heading', { name: 'More insights are coming' })).toBeTruthy();
    const sleep = screen.getByRole('progressbar', { name: 'Sleep' });
    expect(sleep.getAttribute('aria-valuetext')).toBe('Day 2 of 3');
    expect(sleep.getAttribute('aria-valuenow')).toBe('67');
    expect(
      screen.getByRole('progressbar', { name: 'Sleep rhythm' }).getAttribute('aria-valuetext'),
    ).toBe('Day 2 of 7');
    // Sleep, feeding and diapers need one more day; the rhythm five more.
    expect(screen.getAllByText('About 1 more day of logging')).toHaveLength(3);
    expect(screen.getByText('About 5 more days of logging')).toBeTruthy();
    expect(screen.queryByRole('radiogroup', { name: 'Period' })).toBeNull();
  });

  it('asks to start logging when there is nothing yet', async () => {
    renderSection();
    expect(await screen.findAllByText('Start logging naps and nights to unlock')).toHaveLength(2);
    expect(screen.getByText('Start logging feeds to unlock')).toBeTruthy();
    expect(screen.getByText('Start logging diapers to unlock')).toBeTruthy();
    expect(
      screen.getByRole('progressbar', { name: 'Diapers' }).getAttribute('aria-valuetext'),
    ).toBe('Day 0 of 3');
  });

  it('is clean for axe', async () => {
    await seedDays(2);
    renderSection();
    await screen.findByRole('heading', { name: 'More insights are coming' });
    expect(await axeViolations()).toEqual([]);
  });
});

describe('once insights open', () => {
  it('shows a card per open insight and keeps the others as progress rows', async () => {
    await seedDays(5);
    renderSection();
    for (const name of ['Sleep', 'Feeding', 'Diapers']) {
      expect(await screen.findByRole('heading', { name, level: 2 })).toBeTruthy();
    }
    const onTheWay = screen.getByRole('region', { name: 'On the way' });
    const rhythm = within(onTheWay).getByRole('progressbar', { name: 'Sleep rhythm' });
    expect(rhythm.getAttribute('aria-valuetext')).toBe('Day 5 of 7');
    expect(within(onTheWay).getByText('About 2 more days of logging')).toBeTruthy();
  });

  it('heads each card with the averages of the range and draws them as a reference line', async () => {
    await seedDays(14);
    renderSection();
    const feeding = await screen.findByRole('region', { name: 'Feeding' });
    expect(within(feeding).getByText('Average of the logged days, last 14 days')).toBeTruthy();
    expect(within(feeding).getByText('4 feeds / day')).toBeTruthy();
    expect(within(feeding).getByText('120 mL / day')).toBeTruthy();
    expect(within(feeding).getAllByTestId('insights-reference')).toHaveLength(2);
    expect(within(feeding).getByText(/On the days with bottles, about 120 mL a day/)).toBeTruthy();

    const diapers = screen.getByRole('region', { name: 'Diapers' });
    expect(within(diapers).getByText('2 diapers / day')).toBeTruthy();
    expect(within(diapers).getByText(/About 2 wet and 1 dirty a day/)).toBeTruthy();
    expect(within(diapers).getAllByTestId('insights-reference')).toHaveLength(1);

    const sleep = screen.getByRole('region', { name: 'Sleep' });
    // A 1 h nap and a 10 h night a day.
    expect(within(sleep).getByText('11h / day')).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Sleep rhythm' })).toBeTruthy();
    expect(
      within(screen.getByRole('region', { name: 'Sleep rhythm' })).getByText('20:00'),
    ).toBeTruthy();
  });

  it('shows the numbers as a table and back', async () => {
    await seedDays(14);
    renderSection();
    const feeding = await screen.findByRole('region', { name: 'Feeding' });
    fireEvent.click(within(feeding).getByRole('button', { name: 'View as table' }));
    const table = within(feeding).getByRole('table', { name: 'Feeding' });
    const rows = within(table).getAllByRole('row');
    // Header plus 14 days, newest first: today has nothing yet.
    expect(rows).toHaveLength(15);
    expect(
      within(rows[0])
        .getAllByRole('columnheader')
        .map((c) => c.textContent),
    ).toEqual(['Day', 'Feeds', 'Bottle ml']);
    expect(
      within(rows[1])
        .getAllByRole('cell')
        .map((c) => c.textContent),
    ).toEqual(['0', '–']);
    expect(
      within(rows[2])
        .getAllByRole('cell')
        .map((c) => c.textContent),
    ).toEqual(['4', '120 mL']);
    fireEvent.click(within(feeding).getByRole('button', { name: 'View as chart' }));
    expect(within(feeding).queryByRole('table')).toBeNull();
    expect(within(feeding).getAllByRole('img').length).toBeGreaterThan(0);
  });

  it('switches the range between 7, 14 and 30 days', async () => {
    await seedDays(14);
    renderSection();
    const sleep = await screen.findByRole('region', { name: 'Sleep' });
    expect(within(sleep).getAllByTestId('insights-column')).toHaveLength(14);
    fireEvent.click(screen.getByRole('radio', { name: '7 days' }));
    expect(within(sleep).getAllByTestId('insights-column')).toHaveLength(7);
    expect(within(sleep).getByText('Average of the logged days, last 7 days')).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: '30 days' }));
    expect(within(sleep).getAllByTestId('insights-column')).toHaveLength(30);
    const rhythm = screen.getByRole('region', { name: 'Sleep rhythm' });
    expect(within(rhythm).getAllByTestId('insights-rhythm-row')).toHaveLength(30);
  });

  it('is clean for axe, with a table open too', async () => {
    await seedDays(14);
    renderSection();
    const diapers = await screen.findByRole('region', { name: 'Diapers' });
    fireEvent.click(within(diapers).getByRole('button', { name: 'View as table' }));
    expect(await axeViolations()).toEqual([]);
  });
});

describe('in Portuguese', () => {
  it('speaks Portuguese while waiting and once open', async () => {
    await useTestLocale('pt-BR');
    await seedDays(2);
    const view = renderSection();
    expect(await screen.findByRole('heading', { name: 'Mais análises a caminho' })).toBeTruthy();
    expect(
      screen.getByRole('progressbar', { name: 'Ritmo do sono' }).getAttribute('aria-valuetext'),
    ).toBe('Dia 2 de 7');
    expect(screen.getAllByText('Cerca de mais 1 dia de registros')).toHaveLength(3);
    view.unmount();

    await seedDays(12, 3);
    renderSection();
    const feeding = await screen.findByRole('region', { name: 'Alimentação' });
    expect(within(feeding).getByText('4 mamadas / dia')).toBeTruthy();
    expect(within(feeding).getByText('Média dos dias registrados, últimos 14 dias')).toBeTruthy();
    expect(screen.getByRole('radio', { name: '30 dias' })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Ver como tabela' }).length).toBeGreaterThan(0);
  });
});
