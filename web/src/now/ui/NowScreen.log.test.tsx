import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BabyRoutineDb } from '../../db/database';
import { recordLastUsed } from '../../events/lastUsedValues';
import { FEEDING_TYPE } from '../../test/builtInTypes';
import { fakeApi, testDatabase } from '../../test/fakeApi';
import { renderWithDb, settleSync } from '../../test/renderApp';
import { BABY, BELLY_TYPE, holdToast, nowApi, putEvent, seedMorning, seedNow } from './nowKit';
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

function renderNow() {
  const { api } = fakeApi(nowApi());
  return renderWithDb(db, <NowScreen baby={BABY} />, { api });
}

const live = async () => (await db.events.toArray()).filter((e) => e.deletedAt === null);
/** Events the test just caused (the seeded ones were created long ago). */
const logged = async () =>
  (await live()).filter((e) => Date.now() - Date.parse(e.createdAt) < 60_000);
const tile = (name: RegExp) => screen.findByRole('button', { name });

describe('the last-and-log tiles', () => {
  it('shows Feed, Diaper, Meds and More with the last event and its detail', async () => {
    await seedNow(db);
    await seedMorning(db, 112);
    renderNow();

    const feed = await tile(/^Feed/);
    expect(feed.textContent).toMatch(/Last 4h ago/);
    expect(feed.textContent).toMatch(/Bottle · 120 mL/);
    expect((await tile(/^Diaper/)).textContent).toMatch(/Last 2h ago.*Wet/);
    expect((await tile(/^Meds/)).textContent).toMatch(/Not tracked today/);
    expect((await tile(/^More/)).textContent).toMatch(/Bath, pump and more/);
  });

  it('are disabled for viewers, who can still read them', async () => {
    await seedNow(db, { role: 'Viewer' });
    await seedMorning(db, 112);
    const { api } = fakeApi(nowApi());
    renderWithDb(db, <NowScreen baby={{ ...BABY, role: 'Viewer' }} />, { api });

    expect(await screen.findByText(/view-only access/)).toBeTruthy();
    for (const name of [/^Feed/, /^Diaper/, /^Meds/, /^More/]) {
      expect(((await tile(name)) as HTMLButtonElement).disabled).toBe(true);
    }
    expect(
      (screen.getByRole('button', { name: 'Fell asleep' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Fell asleep' }));
    expect(await live()).toHaveLength(3);
  });
});

describe('Diaper tray', () => {
  it.each([
    ['Wet', 'WET'],
    ['Dirty', 'DIRTY'],
    ['Mixed', 'MIXED'],
  ])('%s logs an instant diaper in one tap, with the toast', async (label, content) => {
    await seedNow(db);
    await seedMorning(db, 112);
    renderNow();

    fireEvent.click(await tile(/^Diaper/));
    const tray = await screen.findByRole('dialog', { name: 'Diaper' });
    fireEvent.click(within(tray).getByRole('button', { name: label }));

    expect(await screen.findByText(`Diaper logged, ${label}`)).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Diaper' })).toBeNull());
    const diapers = (await logged()).filter((e) => e.payload.content === content);
    expect(diapers).toHaveLength(1);
    expect(diapers[0].endedAt).toBe(diapers[0].startedAt);
  });

  it('the toast offers Undo and the -5 / -10 / -15 chips for a diaper', async () => {
    await seedNow(db);
    await seedMorning(db, 112);
    renderNow();

    fireEvent.click(await tile(/^Diaper/));
    fireEvent.click(await screen.findByRole('button', { name: 'Wet' }));
    await holdToast();
    const group = await screen.findByRole('group', { name: 'When it happened' });
    expect(
      within(group)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['Now', '−5 min', '−10 min', '−15 min']);
    fireEvent.click(within(group).getByRole('button', { name: '−15 min' }));
    await waitFor(async () => {
      const [wet] = (await logged()).filter((e) => e.payload.content === 'WET');
      expect(Date.now() - Date.parse(wet.startedAt)).toBeGreaterThan(14.5 * 60_000);
      expect(wet.endedAt).toBe(wet.startedAt);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(async () =>
      expect((await live()).filter((e) => e.payload.content === 'WET')).toHaveLength(1),
    );
  });

  it('keeps the toast in a polite live region and pauses it while hovered', async () => {
    await seedNow(db);
    await seedMorning(db, 112);
    renderNow();

    fireEvent.click(await tile(/^Diaper/));
    fireEvent.click(await screen.findByRole('button', { name: 'Dirty' }));
    const toast = await screen.findByTestId('quick-log-toast');
    const region = toast.closest('[role="status"]');
    expect(region?.getAttribute('aria-live')).toBe('polite');
    // Pausing and resuming must not drop the toast.
    fireEvent.pointerEnter(toast);
    fireEvent.pointerLeave(toast);
    expect(screen.getByTestId('quick-log-toast')).toBeTruthy();
  });

  it('Ctrl+Z undoes the last log', async () => {
    await seedNow(db);
    await seedMorning(db, 112);
    renderNow();

    fireEvent.click(await tile(/^Diaper/));
    fireEvent.click(await screen.findByRole('button', { name: 'Mixed' }));
    await holdToast();
    await screen.findByText('Diaper logged, Mixed');
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    await waitFor(async () =>
      expect((await live()).some((e) => e.payload.content === 'MIXED')).toBe(false),
    );
  });
});

describe('Feed tray', () => {
  it('opens on the last method with the last amount selected: one tap repeats the last bottle', async () => {
    await seedNow(db);
    await seedMorning(db, 112);
    renderNow();

    fireEvent.click(await tile(/^Feed/));
    const tray = await screen.findByRole('dialog', { name: 'Feed' });
    expect(within(tray).getByRole('radio', { name: 'Bottle' }).getAttribute('aria-checked')).toBe(
      'true',
    );
    expect(within(tray).getByRole('radio', { name: '120 ml' }).getAttribute('aria-checked')).toBe(
      'true',
    );
    expect(within(tray).getByRole('radio', { name: 'Formula' }).getAttribute('aria-checked')).toBe(
      'true',
    );

    fireEvent.click(within(tray).getByRole('button', { name: 'Log 120 ml formula' }));
    expect(await screen.findByText('Bottle logged, 120 ml')).toBeTruthy();
    const bottles = (await logged()).filter((e) => e.payload.method === 'bottle');
    expect(bottles).toHaveLength(1);
    expect(bottles[0].payload).toEqual({
      method: 'bottle',
      amount_ml: 120,
      bottle_feeding_type: 'formula',
    });
    expect(bottles[0].endedAt).toBe(bottles[0].startedAt);
  });

  it('a chip or another amount changes what is logged', async () => {
    await seedNow(db);
    await seedMorning(db, 112);
    renderNow();

    fireEvent.click(await tile(/^Feed/));
    const tray = await screen.findByRole('dialog', { name: 'Feed' });
    fireEvent.click(within(tray).getByRole('radio', { name: '90 ml' }));
    fireEvent.click(within(tray).getByRole('radio', { name: 'Breast milk' }));
    fireEvent.click(within(tray).getByRole('button', { name: 'Log 90 ml breast milk' }));

    await screen.findByText('Bottle logged, 90 ml');
    expect(
      (await live()).filter(
        (e) => e.payload.amount_ml === 90 && e.payload.bottle_feeding_type === 'breast_milk',
      ),
    ).toHaveLength(1);
  });

  it('Other amount shows a stepper and logs the typed value', async () => {
    await seedNow(db);
    await seedMorning(db, 112);
    renderNow();

    fireEvent.click(await tile(/^Feed/));
    const tray = await screen.findByRole('dialog', { name: 'Feed' });
    fireEvent.click(within(tray).getByRole('radio', { name: 'Other amount' }));
    fireEvent.click(within(tray).getByRole('button', { name: 'Increase' }));
    fireEvent.click(within(tray).getByRole('button', { name: /^Log 130 ml/ }));

    await screen.findByText('Bottle logged, 130 ml');
    expect((await live()).filter((e) => e.payload.amount_ml === 130)).toHaveLength(1);
  });

  it('Breast starts the nursing timer on the side opposite to the last feed', async () => {
    await seedNow(db);
    await putEvent(db, 'sleep', 150, 40, { kind: 'nap' });
    await putEvent(db, 'feeding', 200, 190, { method: 'breast', side: 'left', last_side: 'left' });
    renderNow();

    fireEvent.click(await tile(/^Feed/));
    const tray = await screen.findByRole('dialog', { name: 'Feed' });
    fireEvent.click(within(tray).getByRole('radio', { name: 'Breast' }));
    expect(within(tray).getByText('Last time you used the left side.')).toBeTruthy();
    fireEvent.click(within(tray).getByRole('button', { name: 'Start on the right' }));

    expect(await screen.findByText('Nursing on the right')).toBeTruthy();
    const running = (await live()).find((e) => e.endedAt === null && e.payload.method === 'breast');
    expect(running?.payload.side).toBe('right');
    expect(await screen.findByRole('region', { name: 'Nursing' })).toBeTruthy();
  });

  it('Solid food opens the event sheet prefilled', async () => {
    await seedNow(db);
    await seedMorning(db, 112);
    renderNow();

    fireEvent.click(await tile(/^Feed/));
    const tray = await screen.findByRole('dialog', { name: 'Feed' });
    fireEvent.click(within(tray).getByRole('radio', { name: 'Solid food' }));
    fireEvent.click(within(tray).getByRole('button', { name: 'Open the form' }));

    expect(await screen.findByRole('heading', { name: 'Feeding' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Solid food' }).getAttribute('aria-checked')).toBe(
      'true',
    );
  });

  it("remembers this device's last bottle when the baby has none yet", async () => {
    await seedNow(db);
    await putEvent(db, 'sleep', 150, 40, { kind: 'nap' });
    recordLastUsed(BABY.id, FEEDING_TYPE, { method: 'bottle', amount_ml: 150 });
    renderNow();

    fireEvent.click(await tile(/^Feed/));
    const tray = await screen.findByRole('dialog', { name: 'Feed' });
    expect(within(tray).getByRole('radio', { name: '150 ml' }).getAttribute('aria-checked')).toBe(
      'true',
    );
  });
});

describe('Meds tray', () => {
  it('logs the selected usual medications with their default doses', async () => {
    await seedNow(db);
    await seedMorning(db, 112);
    renderNow();

    fireEvent.click(await tile(/^Meds/));
    const tray = await screen.findByRole('dialog', { name: 'Medication' });
    const log = within(tray).getByRole('button', {
      name: 'Choose a medication',
    }) as HTMLButtonElement;
    expect(log.disabled).toBe(true);
    fireEvent.click(within(tray).getByRole('button', { name: 'Colidis' }));
    fireEvent.click(within(tray).getByRole('button', { name: 'Paracetamol' }));
    fireEvent.click(within(tray).getByRole('button', { name: 'Log 2 medications' }));

    expect(await screen.findByText('Medication logged, Colidis and Paracetamol')).toBeTruthy();
    const [logged] = (await live()).filter((e) => Array.isArray(e.payload.medications));
    expect(logged.payload.medications).toEqual([
      { medicationId: 'm-colidis', name: 'Colidis', dose: { amount: 5, unit: 'drops' } },
      { medicationId: 'm-paracetamol', name: 'Paracetamol' },
    ]);
  });

  it('"Same as last time" repeats the previous entry in one tap', async () => {
    await seedNow(db);
    await seedMorning(db, 112);
    await putEvent(db, 'medication', 200, 200, {
      medications: [
        { medicationId: 'm-colidis', name: 'Colidis', dose: { amount: 5, unit: 'drops' } },
      ],
    });
    renderNow();

    fireEvent.click(await tile(/^Meds/));
    fireEvent.click(await screen.findByRole('button', { name: 'Same as last time: Colidis' }));
    await screen.findByText('Medication logged, Colidis');
    expect((await live()).filter((e) => Array.isArray(e.payload.medications))).toHaveLength(2);
  });

  it('points to Settings when the baby has no medications', async () => {
    await seedNow(db, { medications: false });
    await seedMorning(db, 112);
    renderNow();

    fireEvent.click(await tile(/^Meds/));
    const tray = await screen.findByRole('dialog', { name: 'Medication' });
    expect(within(tray).getByText(/No medications yet\./)).toBeTruthy();
    expect(
      within(tray).getByRole('link', { name: 'Add them in Settings' }).getAttribute('href'),
    ).toBe('/settings#medications');
  });
});

describe('More sheet', () => {
  it('lists every preset in a two-column grid with its status', async () => {
    await seedNow(db);
    await seedMorning(db, 112);
    renderNow();

    fireEvent.click(await tile(/^More/));
    const sheet = await screen.findByRole('dialog', { name: 'More' });
    const names = within(within(sheet).getByTestId('more-grid'))
      .getAllByRole('button')
      .map((b) => b.getAttribute('aria-label')?.split(',')[0]);
    expect(names).toEqual([
      'Log Wake-up',
      'Start Nap',
      'Log Bedtime',
      'Log Fell asleep',
      'Start Night waking',
      'Log Bottle',
      'Start Nursing',
      'Log Diaper',
      'Log Medication',
      'Log Belly pain',
      'Log Bath',
      'Start Tummy time',
      'Custom',
    ]);
    expect(within(sheet).getAllByText('Not tracked today').length).toBeGreaterThan(4);
    const results = await axe.run(sheet, { runOnly: ['aria-dialog-name', 'button-name'] });
    expect(results.violations).toEqual([]);
  });

  it('Belly pain opens its tray and one tap logs the intensity', async () => {
    await seedNow(db);
    await seedMorning(db, 112);
    renderNow();

    fireEvent.click(await tile(/^More/));
    fireEvent.click(await screen.findByRole('button', { name: /^Log Belly pain/ }));
    const tray = await screen.findByRole('dialog', { name: 'Belly pain' });
    expect(within(tray).getAllByRole('button', { name: /^[1-5]$/ })).toHaveLength(5);
    fireEvent.click(within(tray).getByRole('button', { name: '4' }));

    expect(await screen.findByText('Belly pain logged, 4 of 5')).toBeTruthy();
    const [saved] = (await live()).filter((e) => e.typeId === BELLY_TYPE.id);
    expect(saved.payload).toEqual({ intensity: 4 });
  });

  it('Bottle, Diaper and Medication open their trays, Nursing starts the live timer', async () => {
    await seedNow(db);
    await seedMorning(db, 112);
    renderNow();

    fireEvent.click(await tile(/^More/));
    fireEvent.click(await screen.findByRole('button', { name: /^Log Diaper/ }));
    expect(await screen.findByRole('dialog', { name: 'Diaper' })).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'Diaper' }), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Diaper' })).toBeNull());

    fireEvent.click(await tile(/^More/));
    fireEvent.click(await screen.findByRole('button', { name: /^Start Nursing/ }));
    expect(await screen.findByText(/^Nursing on the (left|right)$/)).toBeTruthy();
    expect(await screen.findByRole('region', { name: 'Nursing' })).toBeTruthy();
  });

  it('a timer preset starts with the old Undo snackbar and a sheet preset opens the event sheet', async () => {
    await seedNow(db);
    await seedMorning(db, 112);
    renderNow();

    fireEvent.click(await tile(/^More/));
    fireEvent.click(await screen.findByRole('button', { name: /^Start Tummy time/ }));
    expect(await screen.findByText('Tummy time started')).toBeTruthy();
    expect((await live()).some((e) => e.endedAt === null && e.typeId === 'type-tummy')).toBe(true);

    fireEvent.click(await tile(/^More/));
    fireEvent.click(await screen.findByRole('button', { name: /^Log Bath/ }));
    expect(await screen.findByRole('heading', { name: 'Bath' })).toBeTruthy();
  });

  it('the Custom tile opens the event type settings', async () => {
    await seedNow(db);
    await seedMorning(db, 112);
    renderNow();

    fireEvent.click(await tile(/^More/));
    fireEvent.click(await screen.findByRole('button', { name: 'Custom' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'More' })).toBeNull());
  });
});
