import { screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import axe from 'axe-core';
import type { BabyRoutineDb } from '../db/database';
import { createEvent } from '../db/eventCommands';
import { activateLocale, t } from '../i18n/i18n';
import { FEEDING_TYPE, SLEEP_TYPE } from '../test/builtInTypes';
import { BABY_ID, testDatabase } from '../test/fakeApi';
import { renderWithDb } from '../test/renderApp';
import { seedBaby } from '../test/seed';
import { EventSheet } from './EventSheet';

/*
 * Bottle amount chips in the event sheet follow the baby (docs/design/10-bottle-suggestions.md):
 * the age table on a cold start (with its caption), the baby's own bottles once there are some.
 */

let db: BabyRoutineDb;

beforeEach(async () => {
  db = testDatabase();
  await seedBaby(db);
});

afterEach(async () => {
  await db.delete();
});

/** A birth date exactly `months` whole months before today (the 1st of that month). */
function bornMonthsAgo(months: number): string {
  const now = new Date();
  const birth = new Date(now.getFullYear(), now.getMonth() - months, 1);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${birth.getFullYear()}-${pad(birth.getMonth() + 1)}-${pad(birth.getDate())}`;
}

async function putBottles(...amounts: number[]) {
  for (const [i, amount] of amounts.entries()) {
    const at = new Date(Date.now() - (i + 1) * 3 * 3_600_000).toISOString();
    await createEvent(db, {
      babyId: BABY_ID,
      typeId: FEEDING_TYPE.id,
      startedAt: at,
      endedAt: at,
      payload: { method: 'bottle', amount_ml: amount },
    });
  }
}

/** The feeding sheet opened on a bottle (the amount field shows). */
function renderBottle() {
  const now = new Date().toISOString();
  renderWithDb(
    db,
    <EventSheet
      babyId={BABY_ID}
      types={[FEEDING_TYPE, SLEEP_TYPE]}
      prefill={{
        typeId: FEEDING_TYPE.id,
        startedAt: now,
        endedAt: now,
        payload: { method: 'bottle' },
      }}
      onDone={() => {}}
    />,
  );
}

const chips = async () =>
  within(await screen.findByRole('group', { name: 'Quick values' }))
    .getAllByRole('button')
    .map((b) => b.textContent);

describe('bottle amount chips', () => {
  it('cold start: typical amounts for the age, with a "not advice" caption', async () => {
    await db.babies.update(BABY_ID, { birthDate: bornMonthsAgo(3) });
    renderBottle();
    expect(
      await screen.findByText('Typical for 3 months. Based on common ranges, not advice.'),
    ).toBeTruthy();
    expect(await chips()).toEqual(['120 ml', '150 ml', '180 ml']);
  });

  it('from the baby own bottles: typical, topped up, no age caption', async () => {
    await db.babies.update(BABY_ID, { birthDate: bornMonthsAgo(1) });
    await putBottles(120, 120, 180, 120);
    renderBottle();
    expect(await screen.findByText('From your recent feeds')).toBeTruthy();
    expect(await chips()).toEqual(['120 ml', '150 ml', '180 ml']);
    expect(screen.queryByText(/Typical for/)).toBeNull();
  });

  it('a newborn reads newborns; no judgement words anywhere', async () => {
    await db.babies.update(BABY_ID, { birthDate: bornMonthsAgo(0) });
    renderBottle();
    const caption = await screen.findByTestId('bottle-suggestion-caption');
    expect(caption.textContent).toBe('Typical for newborns. Based on common ranges, not advice.');
    expect(document.body.textContent).not.toMatch(/too (little|much)/i);
  });

  it('has no axe violation around the amount and its caption', async () => {
    await db.babies.update(BABY_ID, { birthDate: bornMonthsAgo(2) });
    renderBottle();
    await screen.findByTestId('bottle-suggestion-caption');
    const results = await axe.run(screen.getByRole('dialog'));
    expect(results.violations).toEqual([]);
  });
});

describe('caption copy', () => {
  it('reads in pt-BR with plurals', async () => {
    try {
      await activateLocale('pt-BR');
      expect(t('events.bottleSuggestions.age', { count: 1 })).toMatch(/^Comum com 1 mês\./);
      expect(t('events.bottleSuggestions.age', { count: 4 })).toMatch(/^Comum com 4 meses\./);
    } finally {
      await activateLocale('en');
    }
    expect(t('events.bottleSuggestions.age', { count: 1 })).toMatch(/^Typical for 1 month\./);
  });
});
