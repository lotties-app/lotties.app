import { fireEvent, screen, within } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BabyRoutineDb } from '../db/database';
import type { BabyEvent, EventPayload, Formula } from '../db/models';
import { BABY, BELLY_TYPE, NOW_TYPES } from '../now/ui/nowKit';
import { DIAPER_TYPE, FEEDING_TYPE } from '../test/builtInTypes';
import { testDatabase } from '../test/fakeApi';
import { useTestLocale } from '../test/locale';
import { renderWithDb, settleSync } from '../test/renderApp';
import { THEME_STORAGE_KEY } from '../theme/themeStorage';
import { InsightsSection } from './InsightsSection';

/*
 * The Formulas card on a pinned clock (21 Oct 2026, 15:00 local): two formulas over three weeks
 * side by side, a formula still collecting days, the statements and the plain note, the table.
 */

let db: BabyRoutineDb;
let seq = 0;

const at = (back: number, hour: number, minute = 0) =>
  new Date(2026, 9, 21 - back, hour, minute).toISOString();

function make(typeId: string, start: string, payload: EventPayload): BabyEvent {
  seq += 1;
  return {
    id: `fi-${seq}`,
    babyId: BABY.id,
    typeId,
    startedAt: start,
    endedAt: start,
    payload,
    notes: null,
    createdBy: null,
    createdAt: start,
    updatedAt: start,
    deletedAt: null,
  };
}

const formula = (id: string, name: string, extra: Partial<Formula> = {}): Formula => ({
  id,
  babyId: BABY.id,
  name,
  brand: null,
  stage: null,
  notes: null,
  startedOn: null,
  isCurrent: false,
  archived: false,
  createdBy: null,
  createdAt: at(30, 8),
  updatedAt: at(30, 8),
  ...extra,
});

/** Bottles of `formulaId` (4 a day, 150 ml) from `from` days back to `to`, plus diapers. */
async function seedFormula(formulaId: string, name: string, from: number, to: number, pains = 0) {
  const events: BabyEvent[] = [];
  for (let back = from; back >= to; back--) {
    for (const hour of [7, 11, 15, 19]) {
      events.push(
        make(FEEDING_TYPE.id, at(back, hour), {
          method: 'bottle',
          amount_ml: 150,
          bottle_feeding_type: 'formula',
          formula_id: formulaId,
          formula_name: name,
        }),
      );
    }
    events.push(make(DIAPER_TYPE.id, at(back, 9), { content: 'DIRTY' }));
    if (back % 5 < pains) events.push(make(BELLY_TYPE.id, at(back, 16), { intensity: 2 }));
  }
  await db.events.bulkPut(events);
}

function renderSection() {
  return renderWithDb(
    db,
    <InsightsSection baby={BABY} weights={[{ date: '2026-10-05', kg: 5 }]} />,
  );
}

async function axeViolations() {
  const result = await axe.run(document.body, {
    runOnly: ['wcag2a', 'wcag2aa'],
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
  await db.formulas.bulkPut([
    formula('f-a', 'Nan 1'),
    formula('f-b', 'Aptamil 2', { isCurrent: true }),
  ]);
});

afterEach(async () => {
  await settleSync();
  await db.delete();
  vi.useRealTimers();
});

describe('the Formulas card', () => {
  it('compares two formulas side by side with statements and the plain note', async () => {
    await seedFormula('f-a', 'Nan 1', 21, 11, 2); // 11 days, 2 of 5 days with a belly pain
    await seedFormula('f-b', 'Aptamil 2', 10, 1, 1); // 10 days, 1 of 5 days with a belly pain
    renderSection();

    const card = await screen.findByRole('region', { name: 'Formulas' });
    expect(
      within(card).getByText(
        'While on Aptamil 2: 0.2 belly pains/day, on Nan 1: 0.5. While on Aptamil 2: 600 mL/day, on Nan 1: 600 mL.',
      ),
    ).toBeTruthy();
    expect(within(card).getByTestId('formula-note').textContent).toBe(
      'This compares what you logged. Many things change over time (age, growth, illness), so it does not show that a formula causes anything. Talk to your pediatrician before changing a formula or the amount.',
    );
    expect(within(card).getByText(/10 days · 40 bottles$/)).toBeTruthy();
    expect(within(card).getByText(/11 days · 44 bottles$/)).toBeTruthy();
    const bars = within(card).getByRole('group', { name: 'Belly pains per day' });
    expect(within(bars).getByText('0.2')).toBeTruthy();
    expect(within(bars).getByText('0.5')).toBeTruthy();
    expect(within(card).getByRole('group', { name: 'Bottle milk per kg per day' })).toBeTruthy();
    expect(card.textContent).not.toMatch(
      /caus(es|ing) (the|her|his)|better|worse|should|recommend/i,
    );
  });

  it('shows the same numbers as a table', async () => {
    await seedFormula('f-a', 'Nan 1', 21, 11, 2);
    await seedFormula('f-b', 'Aptamil 2', 10, 1, 1);
    renderSection();
    const card = await screen.findByRole('region', { name: 'Formulas' });

    fireEvent.click(within(card).getByRole('button', { name: 'View as table' }));

    const table = within(card).getByRole('table');
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((h) => h.textContent),
    ).toEqual(['Per day', 'Aptamil 2', 'Nan 1']);
    const row = within(table).getByRole('row', { name: /Bottles per day/ });
    expect(
      within(row)
        .getAllByRole('cell')
        .map((c) => c.textContent),
    ).toEqual(['4', '4']);
  });

  it('shows one formula alone and lists a formula still collecting days', async () => {
    await seedFormula('f-a', 'Nan 1', 14, 4);
    await seedFormula('f-b', 'Aptamil 2', 3, 1);
    renderSection();

    const card = await screen.findByRole('region', { name: 'Formulas' });
    expect(within(card).getByText('4 bottles / day')).toBeTruthy();
    expect(within(card).getByText('While on Nan 1: 600 mL/day.')).toBeTruthy();
    const waiting = within(card).getByRole('progressbar', { name: 'Formula: Aptamil 2' });
    expect(waiting.getAttribute('aria-valuetext')).toBe('Day 3 of 7');
    expect(within(card).getByText('Shows after 4 more days with this formula')).toBeTruthy();
  });

  it('is a readiness row while no formula has 7 days and 20 bottles', async () => {
    await seedFormula('f-b', 'Aptamil 2', 4, 1);
    renderSection();

    const row = await screen.findByRole('progressbar', { name: 'Formula: Aptamil 2' });
    expect(row.getAttribute('aria-valuetext')).toBe('Day 4 of 7');
    expect(screen.queryByRole('region', { name: 'Formulas' })).toBeNull();
  });

  it('stays away for a family that never named a formula', async () => {
    renderSection();
    await screen.findByRole('heading', { name: 'More insights are coming' });
    expect(screen.queryByText(/Formula:/)).toBeNull();
  });
});

describe.each(['light', 'dark'] as const)('the Formulas card in the %s scheme', (scheme) => {
  it.each(['en', 'pt-BR'] as const)(
    'has no accessibility violations in %s, also as a table',
    async (locale) => {
      window.localStorage.setItem(THEME_STORAGE_KEY, scheme);
      if (locale === 'pt-BR') await useTestLocale('pt-BR');
      await seedFormula('f-a', 'Nan 1', 21, 11, 2);
      await seedFormula('f-b', 'Aptamil 2', 10, 1, 1);
      renderSection();
      const card = await screen.findByRole('region', {
        name: locale === 'en' ? 'Formulas' : 'Fórmulas',
      });
      expect(await axeViolations()).toEqual([]);
      fireEvent.click(
        within(card).getByRole('button', {
          name: locale === 'en' ? 'View as table' : 'Ver como tabela',
        }),
      );
      expect(await axeViolations()).toEqual([]);
    },
    60_000,
  );
});

describe('in Portuguese', () => {
  it('says "Com ..." and the note in Portuguese', async () => {
    await useTestLocale('pt-BR');
    await seedFormula('f-a', 'Nan 1', 21, 11, 2);
    await seedFormula('f-b', 'Aptamil 2', 10, 1, 1);
    renderSection();

    const card = await screen.findByRole('region', { name: 'Fórmulas' });
    expect(
      within(card).getByText(/^Com Aptamil 2: 0,2 dor de barriga\/dia; com Nan 1: 0,5\./),
    ).toBeTruthy();
    expect(within(card).getByTestId('formula-note').textContent).toMatch(
      /^Isto compara o que você registrou\..*Converse com o pediatra antes de trocar a fórmula ou a quantidade\.$/,
    );
  });
});
