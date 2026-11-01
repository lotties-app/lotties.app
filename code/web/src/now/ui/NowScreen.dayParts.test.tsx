import { fireEvent, screen, within } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BabyRoutineDb } from '../../db/database';
import { byParts } from '../../medications/prescriptionFixtures';
import { fakeApi, testDatabase } from '../../test/fakeApi';
import { useTestLocale } from '../../test/locale';
import { renderWithDb, settleSync } from '../../test/renderApp';
import { BABY, nowApi, pinClock, putEvent, seedMorning, seedNow } from './nowKit';
import { NowScreen } from './NowScreen';

/*
 * The Meds tray with a part-of-the-day prescription ("1 drop in the morning"): rows per part,
 * one-tap "Give now" while a part is open, and the same confirmation as an early dose for a second
 * dose in a part or a dose outside the chosen parts (recorded as `override`).
 */

let db: BabyRoutineDb;

beforeEach(() => {
  db = testDatabase();
  window.localStorage.clear();
});

afterEach(async () => {
  await settleSync();
  vi.useRealTimers();
  vi.restoreAllMocks();
  await db.delete();
});

function renderNow() {
  const { api } = fakeApi(nowApi());
  return renderWithDb(db, <NowScreen baby={BABY} />, { api });
}

const medicationEvents = async () =>
  (await db.events.toArray()).filter(
    (e) => e.deletedAt === null && Array.isArray(e.payload.medications),
  );

const openTray = async (tile = /^Meds/, name = 'Medication') => {
  fireEvent.click(await screen.findByRole('button', { name: tile }));
  return screen.findByRole('dialog', { name });
};

/** Colidis 1 drop in the morning and at night, optionally given `agoMin` minutes ago. */
async function seedVitamin(parts: ('morning' | 'afternoon' | 'night')[], agoMin?: number) {
  const rx = byParts('m-colidis', parts, {
    dose: { amount: 1, unit: 'drops', perKg: false, roundingStep: null },
  });
  await db.prescriptions.put(rx);
  if (agoMin !== undefined) {
    await putEvent(db, 'medication', agoMin, agoMin, {
      medications: [
        {
          medicationId: 'm-colidis',
          name: 'Colidis',
          dose: { amount: 1, unit: 'drops' },
          prescriptionId: rx.id,
        },
      ],
    });
  }
  return rx;
}

describe('Meds tray: part of the day', () => {
  it('lists the parts, offers Give now for the open part and logs the prescribed dose', async () => {
    pinClock(9, 0);
    await seedNow(db);
    await seedMorning(db, 112);
    const rx = await seedVitamin(['morning', 'night']);
    renderNow();

    const tray = await openTray();
    const card = within(tray).getAllByRole('listitem')[0];
    expect(card.textContent).toMatch(/Morning: due until 12:00 · 0 of 2 today/);
    const rows = within(card).getByRole('list', { name: "Today's parts of the day" });
    expect(
      within(rows)
        .getAllByRole('listitem')
        .map((row) => row.textContent),
    ).toEqual(['MorningDue until 12:00', 'NightFrom 22:00']);

    fireEvent.click(within(tray).getByRole('button', { name: 'Give Colidis now' }));

    await screen.findByText('Medication logged, Colidis');
    const [logged] = await medicationEvents();
    expect(logged.payload.medications).toEqual([
      {
        medicationId: 'm-colidis',
        name: 'Colidis',
        dose: { amount: 1, unit: 'drops' },
        prescriptionId: rx.id,
      },
    ]);
  });

  it('asks before a second dose in the same part and records the override', async () => {
    pinClock(9, 0);
    await seedNow(db);
    await seedMorning(db, 112);
    const rx = await seedVitamin(['morning', 'night'], 48);
    renderNow();

    const tray = await openTray();
    const card = within(tray).getAllByRole('listitem')[0];
    expect(card.textContent).toMatch(/Next: Night from 22:00 · 1 of 2 today/);
    expect(card.textContent).toMatch(/MorningGiven at 08:12/);
    fireEvent.click(within(tray).getByRole('button', { name: 'Log Colidis' }));
    expect((await within(tray).findByRole('alert')).textContent).toBe(
      'Already given this morning at 08:12. Log another dose anyway?',
    );
    fireEvent.click(within(tray).getByRole('button', { name: 'Log anyway' }));

    await screen.findByText('Medication logged, Colidis');
    const events = await medicationEvents();
    expect(events).toHaveLength(2);
    const newest = events.sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
    expect(newest.payload.medications).toEqual([
      {
        medicationId: 'm-colidis',
        name: 'Colidis',
        dose: { amount: 1, unit: 'drops' },
        prescriptionId: rx.id,
        override: true,
      },
    ]);
  });

  it('asks outside the chosen parts and shows a missed part as information only', async () => {
    pinClock(14, 0);
    await seedNow(db);
    await seedMorning(db, 112);
    await seedVitamin(['morning', 'night']);
    renderNow();

    const tray = await openTray();
    const card = within(tray).getAllByRole('listitem')[0];
    expect(card.textContent).toMatch(/MorningNot logged/);
    fireEvent.click(within(tray).getByRole('button', { name: 'Log Colidis' }));
    expect((await within(tray).findByRole('alert')).textContent).toBe(
      'Not one of the prescribed parts of the day (Morning and Night). Log anyway?',
    );
    fireEvent.click(within(tray).getByRole('button', { name: 'Wait' }));
    expect(await medicationEvents()).toHaveLength(0);
  });

  it('reads the parts in Portuguese', async () => {
    await useTestLocale('pt-BR');
    pinClock(23, 0);
    await seedNow(db);
    await seedMorning(db, 112);
    await seedVitamin(['afternoon', 'night']);
    renderNow();

    const tray = await openTray(/^Remédios/, 'Remédio');
    const card = within(tray).getAllByRole('listitem')[0];
    expect(card.textContent).toMatch(/Madrugada: pendente até amanhã 05:00/);
    expect(card.textContent).toMatch(/TardeNão registrado/);
    expect(within(tray).getByRole('button', { name: 'Dar Colidis agora' })).toBeTruthy();
    await useTestLocale('en');
  });

  it('has no accessibility violations with part rows and the second-dose question', async () => {
    pinClock(9, 0);
    await seedNow(db);
    await seedMorning(db, 112);
    await seedVitamin(['morning', 'night'], 48);
    renderNow();

    const tray = await openTray();
    fireEvent.click(within(tray).getByRole('button', { name: 'Log Colidis' }));
    await within(tray).findByRole('alert');
    const result = await axe.run(document.body, {
      runOnly: ['wcag2a', 'wcag2aa'],
      rules: { 'color-contrast': { enabled: false } },
    });
    expect(
      result.violations.map(
        (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`,
      ),
    ).toEqual([]);
  }, 60_000);
});
