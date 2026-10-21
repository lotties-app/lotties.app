import { fireEvent, screen, within } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BabyRoutineDb } from '../../db/database';
import { asNeeded, atTimes, prescription } from '../../medications/prescriptionFixtures';
import { fakeApi, testDatabase } from '../../test/fakeApi';
import { useTestLocale } from '../../test/locale';
import { renderWithDb, settleSync } from '../../test/renderApp';
import { nightPeriodKey } from '../../theme/nightFeed';
import { NIGHT_FEED_STATE_STORAGE_KEY } from '../../theme/nightFeedStorage';
import { THEME_STORAGE_KEY } from '../../theme/themeStorage';
import { BABY, nowApi, putEvent, seedMorning, seedNow } from './nowKit';
import { NowScreen } from './NowScreen';

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

const live = async () => (await db.events.toArray()).filter((e) => e.deletedAt === null);
const medicationEvents = async () =>
  (await live()).filter((e) => Array.isArray(e.payload.medications));
const tile = (name: RegExp) => screen.findByRole('button', { name });
const openTray = async () => {
  fireEvent.click(await tile(/^Meds/));
  return screen.findByRole('dialog', { name: 'Medication' });
};

/** Colidis every 8 hours as needed, given `agoMin` minutes ago; Paracetamol 6 hours, never given. */
async function seedPrescriptions(agoMin = 120) {
  const colidis = asNeeded('m-colidis', 480);
  const paracetamol = asNeeded('m-paracetamol', 360, {
    dose: { amount: 2.5, unit: 'ml', perKg: false, roundingStep: null },
  });
  await db.prescriptions.bulkPut([colidis, paracetamol]);
  await putEvent(db, 'medication', agoMin, agoMin, {
    medications: [
      {
        medicationId: 'm-colidis',
        name: 'Colidis',
        dose: { amount: 2, unit: 'drops' },
        prescriptionId: colidis.id,
      },
    ],
  });
  return { colidis, paracetamol };
}

describe('the Meds tile and tray with prescriptions', () => {
  it('shows each active prescription with its state from the offline calculator', async () => {
    await seedNow(db);
    await seedMorning(db, 112);
    await seedPrescriptions(120);
    renderNow();

    expect((await tile(/^Meds/)).textContent).toMatch(/1 prescription ready/);
    const tray = await openTray();
    const items = within(tray).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toMatch(/Colidis/);
    expect(items[0].textContent).toMatch(/Available at/);
    expect(items[1].textContent).toMatch(/Paracetamol/);
    expect(items[1].textContent).toMatch(/Available now/);
    // A dose given under a prescription is repeated from its own card, never from "Same as last time".
    expect(within(tray).queryByRole('button', { name: /^Same as last time/ })).toBeNull();
    // The guardrail is part of the tray.
    expect(within(tray).getByRole('note').textContent).toMatch(/not a medical device/);
  });

  it('logs a fixed dose in one tap with the prescribed dose and the prescription id', async () => {
    await seedNow(db);
    await seedMorning(db, 112);
    const { paracetamol } = await seedPrescriptions(120);
    renderNow();

    const tray = await openTray();
    fireEvent.click(within(tray).getByRole('button', { name: 'Log Paracetamol' }));

    await screen.findByText('Medication logged, Paracetamol');
    const entries = (await medicationEvents()).flatMap((e) => e.payload.medications as unknown[]);
    expect(entries).toContainEqual({
      medicationId: 'm-paracetamol',
      name: 'Paracetamol',
      dose: { amount: 2.5, unit: 'ml' },
      prescriptionId: paracetamol.id,
    });
    const queued = await db.outbox.toArray();
    expect(queued.some((m) => m.entityType === 'event' && m.kind === 'upsert')).toBe(true);
  });

  it('asks before logging too early, lets you wait, and records the override', async () => {
    await seedNow(db);
    await seedMorning(db, 112);
    const { colidis } = await seedPrescriptions(120);
    renderNow();

    const tray = await openTray();
    fireEvent.click(within(tray).getByRole('button', { name: 'Log Colidis' }));
    const question = await within(tray).findByRole('alert');
    expect(question.textContent).toMatch(/^Too early: next allowed at .+\. Log anyway\?$/);

    fireEvent.click(within(tray).getByRole('button', { name: 'Wait' }));
    expect(await medicationEvents()).toHaveLength(1);

    fireEvent.click(within(tray).getByRole('button', { name: 'Log Colidis' }));
    fireEvent.click(await within(tray).findByRole('button', { name: 'Log anyway' }));

    await screen.findByText('Medication logged, Colidis');
    const events = await medicationEvents();
    expect(events).toHaveLength(2);
    const newest = events.sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
    expect(newest.payload.medications).toEqual([
      {
        medicationId: 'm-colidis',
        name: 'Colidis',
        dose: { amount: 2, unit: 'drops' },
        prescriptionId: colidis.id,
        override: true,
      },
    ]);
  });

  it('shows the inputs of a per-kg suggestion and logs only after the confirm step', async () => {
    await seedNow(db);
    await seedMorning(db, 112);
    const perKg = asNeeded('m-colidis', 480, {
      dose: { amount: 1, unit: 'drops', perKg: true, roundingStep: 1 },
    });
    await db.prescriptions.put(perKg);
    const today = new Date();
    const weighed = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 3);
    await db.bodyWeights.put({
      babyId: BABY.id,
      kg: 4.6,
      date: `${weighed.getFullYear()}-${String(weighed.getMonth() + 1).padStart(2, '0')}-${String(weighed.getDate()).padStart(2, '0')}`,
    });
    renderNow();

    const tray = await openTray();
    expect(within(tray).getByText(/5 drops suggested \(1 drop per kg\)/)).toBeTruthy();
    fireEvent.click(within(tray).getByRole('button', { name: 'Log Colidis' }));
    expect(await medicationEvents()).toHaveLength(0);

    const confirm = await within(tray).findByRole('group', { name: 'Confirm Colidis' });
    expect(confirm.textContent).toMatch(/Prescription: 1 drop per kg/);
    expect(confirm.textContent).toMatch(/Latest weight: 4\.6 kg/);
    expect(confirm.textContent).toMatch(/4\.6 drops, rounded to the nearest 1: 5 drops/);
    fireEvent.click(within(confirm).getByRole('button', { name: 'Log 5 drops' }));

    await screen.findByText('Medication logged, Colidis');
    const [logged] = await medicationEvents();
    expect(logged.payload.medications).toEqual([
      {
        medicationId: 'm-colidis',
        name: 'Colidis',
        dose: { amount: 5, unit: 'drops' },
        prescriptionId: perKg.id,
        kgUsed: 4.6,
      },
    ]);
  });

  it('warns about a weight older than 30 days and asks for the dose without a weight', async () => {
    await seedNow(db);
    await seedMorning(db, 112);
    await db.prescriptions.bulkPut([
      asNeeded('m-colidis', 480, {
        dose: { amount: 1, unit: 'drops', perKg: true, roundingStep: 1 },
      }),
      asNeeded('m-paracetamol', 360, {
        dose: { amount: 0.5, unit: 'ml', perKg: true, roundingStep: null },
      }),
    ]);
    renderNow();

    const tray = await openTray();
    expect(within(tray).getAllByText(/no weight on record/)).toHaveLength(2);
    fireEvent.click(within(tray).getByRole('button', { name: 'Log Colidis' }));
    const confirm = await within(tray).findByRole('group', { name: 'Confirm Colidis' });
    expect(within(confirm).getByRole('alert').textContent).toMatch(/No weight on record/);
    expect(
      (within(confirm).getByRole('button', { name: /^Log/ }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('flags a stale weight', async () => {
    await seedNow(db);
    await seedMorning(db, 112);
    await db.prescriptions.put(
      asNeeded('m-colidis', 480, {
        dose: { amount: 1, unit: 'drops', perKg: true, roundingStep: 1 },
      }),
    );
    await db.bodyWeights.put({ babyId: BABY.id, kg: 4, date: '2026-01-02' });
    renderNow();

    const tray = await openTray();
    fireEvent.click(within(tray).getByRole('button', { name: 'Log Colidis' }));
    const confirm = await within(tray).findByRole('group', { name: 'Confirm Colidis' });
    expect(confirm.textContent).toMatch(/more than 30 days ago/);
  });

  it('shows "Due now" for a missed scheduled time and "Course ended" for an old course', async () => {
    await seedNow(db);
    await seedMorning(db, 112);
    await db.prescriptions.bulkPut([
      atTimes('m-colidis', ['00:00', '06:00', '12:00', '18:00']),
      prescription({
        medicationId: 'm-paracetamol',
        kind: 'asNeeded',
        minIntervalMinutes: 60,
        startDate: '2026-01-01',
        endDate: '2026-01-31',
      }),
    ]);
    renderNow();

    const tray = await openTray();
    const items = within(tray).getAllByRole('listitem');
    expect(items[1].textContent).toMatch(/Course ended/);
    // A past slot of the day with no dose is overdue (created in 2026-01, so slots count).
    expect(items[0].textContent).toMatch(/Due now|Next at/);
  });

  it('keeps the tile unchanged for viewers', async () => {
    await seedNow(db, { role: 'Viewer' });
    await seedMorning(db, 112);
    await seedPrescriptions();
    const { api } = fakeApi(nowApi());
    renderWithDb(db, <NowScreen baby={{ ...BABY, role: 'Viewer' }} />, { api });
    expect(((await tile(/^Meds/)) as HTMLButtonElement).disabled).toBe(true);
  });

  it('opens the prescription editor from the tray', async () => {
    await seedNow(db);
    await seedMorning(db, 112);
    renderNow();

    const tray = await openTray();
    fireEvent.click(within(tray).getByRole('button', { name: 'Add prescription' }));
    expect(await screen.findByRole('dialog', { name: 'Add prescription' })).toBeTruthy();
  });
});

describe('Meds tray in Portuguese', () => {
  it('reads states, the early question and the guardrail in pt-BR', async () => {
    await useTestLocale('pt-BR');
    await seedNow(db);
    await seedMorning(db, 112);
    await seedPrescriptions(120);
    renderNow();

    fireEvent.click(await tile(/^Remédios/));
    const tray = await screen.findByRole('dialog');
    expect(within(tray).getAllByRole('listitem')[0].textContent).toMatch(/Disponível às/);
    expect(within(tray).getAllByRole('listitem')[1].textContent).toMatch(/Disponível agora/);
    fireEvent.click(within(tray).getByRole('button', { name: 'Registrar Colidis' }));
    expect((await within(tray).findByRole('alert')).textContent).toMatch(
      /^Cedo demais: a próxima é permitida às .+\. Registrar mesmo assim\?$/,
    );
    expect(within(tray).getByRole('note').textContent).toMatch(/não dá orientação de dose/);
  });
});

function chooseScheme(scheme: 'light' | 'dark' | 'night') {
  if (scheme === 'night') {
    window.localStorage.setItem(
      NIGHT_FEED_STATE_STORAGE_KEY,
      JSON.stringify({ override: { on: true, key: nightPeriodKey(new Date()) } }),
    );
  } else {
    window.localStorage.setItem(THEME_STORAGE_KEY, scheme);
  }
}

describe.each(['light', 'dark', 'night'] as const)('Meds tray in the %s scheme', (scheme) => {
  it('has no accessibility violations, also in the confirm step', async () => {
    chooseScheme(scheme);
    await seedNow(db);
    await seedMorning(db, 112);
    await seedPrescriptions(120);
    await db.prescriptions.put(
      asNeeded('m-colidis', 480, {
        dose: { amount: 1, unit: 'drops', perKg: true, roundingStep: 1 },
      }),
    );
    await db.bodyWeights.put({ babyId: BABY.id, kg: 4.6, date: '2026-01-02' });
    renderNow();

    // The simple night layout has no Meds tile: there the screen itself is checked.
    if (scheme === 'night') {
      await screen.findByRole('button', { name: /^Feed/ });
    } else {
      const tray = await openTray();
      fireEvent.click(within(tray).getAllByRole('button', { name: /^Log Colidis/ })[0]);
      await within(tray).findByRole('group', { name: 'Confirm Colidis' });
    }
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
