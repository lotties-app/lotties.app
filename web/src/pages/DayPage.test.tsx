import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BabyRoutineDb } from '../db/database';
import { createEvent } from '../db/eventCommands';
import type { BabyEvent } from '../db/models';
import { BABY_ID, testDatabase } from '../test/fakeApi';
import { renderWithDb } from '../test/renderApp';
import { BELLY, DIAPER, FEEDING, MEDICATION, seedBaby } from '../test/seed';
import { DayPage } from './DayPage';

let db: BabyRoutineDb;

beforeEach(() => {
  db = testDatabase();
});

afterEach(async () => {
  await db.delete();
});

/** Local time `daysAgo` days before today at `h:m`. */
function at(daysAgo: number, h: number, m = 0): string {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo, h, m).toISOString();
}

function synced(overrides: Partial<BabyEvent> & { id: string }): BabyEvent {
  return {
    babyId: BABY_ID,
    typeId: FEEDING,
    startedAt: at(0, 8),
    endedAt: at(0, 8, 30),
    payload: {},
    notes: null,
    createdBy: 'user-1',
    createdAt: at(0, 8),
    updatedAt: at(0, 8),
    deletedAt: null,
    ...overrides,
  };
}

async function seedEvents() {
  await seedBaby(db);
  await db.events.bulkPut([
    synced({ id: 'feed', startedAt: at(0, 8), endedAt: at(0, 8, 45) }),
    synced({
      id: 'belly',
      typeId: BELLY,
      startedAt: at(0, 7),
      endedAt: at(0, 7),
      payload: { intensity: 3 },
    }),
    synced({
      id: 'diaper',
      typeId: DIAPER,
      startedAt: at(1, 20),
      endedAt: at(1, 20),
      payload: { content: 'DIRTY' },
    }),
    synced({ id: 'gone', typeId: DIAPER, startedAt: at(1, 21), deletedAt: at(1, 22) }),
    synced({
      id: 'old',
      typeId: DIAPER,
      startedAt: at(20, 9),
      endedAt: at(20, 9),
      payload: { content: 'WET' },
    }),
  ]);
}

const rowNames = (list: HTMLElement) =>
  within(list)
    .getAllByRole('button', { name: /^Edit / })
    .map((b) => b.getAttribute('aria-label'));

describe('DayPage', () => {
  it('shows today newest first with derived titles, detail lines and a summary', async () => {
    await seedEvents();
    renderWithDb(db, <DayPage />);
    const today = await screen.findByRole('list', { name: /^Today, / });
    expect(rowNames(today)).toEqual(['Edit Feeding, 08:00', 'Edit Belly pain, 07:00']);
    expect(within(today).getByText('08:00 – 08:45')).toBeTruthy();
    expect(within(today).getByText('45m')).toBeTruthy();
    expect(within(today).getByText('Intensity 3/5')).toBeTruthy();
    const summary = screen.getByRole('region', { name: 'Summary of the day' });
    expect(within(summary).getByText('Feeds').nextSibling?.textContent).toBe('1');
    expect(screen.getByRole('img', { name: /The day at a glance/ })).toBeTruthy();
  });

  it('goes to the previous day and back with the Today shortcut', async () => {
    await seedEvents();
    renderWithDb(db, <DayPage />);
    await screen.findByRole('list', { name: /^Today, / });
    expect((screen.getByRole('button', { name: 'Next day' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Previous day' }));
    const yesterday = await screen.findByRole('list', { name: /^Yesterday, / });
    expect(rowNames(yesterday)).toEqual(['Edit Dirty, 20:00']);
    expect(within(yesterday).getByText('Dirty')).toBeTruthy();
    expect(screen.queryByText(/Wet/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Today' }));
    expect(await screen.findByRole('list', { name: /^Today, / })).toBeTruthy();
  });

  it('changes the day by swiping', async () => {
    await seedEvents();
    renderWithDb(db, <DayPage />);
    const today = await screen.findByRole('list', { name: /^Today, / });
    const surface = today.parentElement!;
    fireEvent.touchStart(surface, { touches: [{ clientX: 40, clientY: 100 }] });
    fireEvent.touchEnd(surface, { changedTouches: [{ clientX: 200, clientY: 110 }] });
    const yesterday = await screen.findByRole('list', { name: /^Yesterday, / });
    fireEvent.touchStart(yesterday.parentElement!, { touches: [{ clientX: 200, clientY: 100 }] });
    fireEvent.touchEnd(yesterday.parentElement!, {
      changedTouches: [{ clientX: 40, clientY: 100 }],
    });
    expect(await screen.findByRole('list', { name: /^Today, / })).toBeTruthy();
  });

  it('filters by category in a sheet with a badge, Clear and Done', async () => {
    await seedBaby(db);
    await db.events.bulkPut([
      synced({ id: 'feed', startedAt: at(0, 8), endedAt: at(0, 8, 45) }),
      synced({
        id: 'diaper',
        typeId: DIAPER,
        startedAt: at(0, 9),
        endedAt: at(0, 9),
        payload: { content: 'WET' },
      }),
    ]);
    renderWithDb(db, <DayPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Filter' }));
    const sheet = await screen.findByRole('dialog', { name: 'Show on this day' });
    fireEvent.click(within(sheet).getByRole('checkbox', { name: 'Diapers' }));
    expect(
      within(sheet).getByRole('checkbox', { name: 'Diapers' }).getAttribute('aria-checked'),
    ).toBe('true');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(rowNames(screen.getByRole('list', { name: /^Today, / }))).toEqual(['Edit Wet, 09:00']);
    fireEvent.click(screen.getByRole('button', { name: 'Filter, 1 active' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Clear' }));
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() =>
      expect(rowNames(screen.getByRole('list', { name: /^Today, / }))).toHaveLength(2),
    );
  });

  it('marks running rows with a live timer and Stop, and unsynced or failed rows', async () => {
    await seedBaby(db);
    await createEvent(db, { babyId: BABY_ID, typeId: FEEDING, startedAt: at(0, 0, 1) });
    const failed = await createEvent(db, {
      babyId: BABY_ID,
      typeId: MEDICATION,
      startedAt: at(0, 0),
      endedAt: at(0, 0),
      payload: { medications: [{ medicationId: 'm1', name: 'Colidis' }] },
    });
    await db.outbox.where('entityId').equals(failed.id).modify({ status: 'dead' });
    renderWithDb(db, <DayPage />);
    const today = await screen.findByRole('list', { name: /^Today, / });
    const [runningRow, failedRow] = within(today).getAllByRole('listitem');
    expect(within(runningRow).getByText('Running')).toBeTruthy();
    expect(within(runningRow).getByText('Since 00:01')).toBeTruthy();
    expect(within(runningRow).getByRole('img', { name: 'Not synced yet' })).toBeTruthy();
    expect(within(runningRow).getByRole('button', { name: 'Stop Feeding' })).toBeTruthy();
    expect(within(failedRow).getByText('Colidis')).toBeTruthy();
    expect(within(failedRow).getByText('Needs attention')).toBeTruthy();
    expect(screen.queryByText('Synced')).toBeNull();
  });

  it('stops a running timer from its row', async () => {
    await seedBaby(db);
    const running = await createEvent(db, {
      babyId: BABY_ID,
      typeId: FEEDING,
      startedAt: at(0, 0, 1),
    });
    renderWithDb(db, <DayPage />);
    fireEvent.click(await screen.findByRole('button', { name: /^Stop / }));
    await waitFor(async () => expect((await db.events.get(running.id))?.endedAt).not.toBeNull());
  });

  it('opens the edit sheet when a row is tapped', async () => {
    await seedEvents();
    renderWithDb(db, <DayPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Feeding, 08:00' }));
    expect(await screen.findByRole('dialog', { name: 'Feeding' })).toBeTruthy();
    expect(screen.getByText('Logged 08:00')).toBeTruthy();
  });

  it('shows an empty day with an Add event action that opens the More sheet', async () => {
    await seedBaby(db);
    renderWithDb(db, <DayPage />);
    expect(await screen.findByText('Nothing logged this day')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Add event' }));
    expect(await screen.findByRole('dialog', { name: 'More' })).toBeTruthy();
  });

  it('contains a malformed record to its row (review #5)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await seedEvents();
    await db.eventTypes.put({
      id: 'type-broken',
      babyId: BABY_ID,
      key: 'broken',
      name: 'Broken',
      icon: 'constructor',
      color: '#000000',
      hasDuration: false,
      fields: 'not a list' as unknown as [],
    });
    await db.events.put(synced({ id: 'bad', typeId: 'type-broken', startedAt: at(0, 9) }));
    renderWithDb(db, <DayPage />);
    expect(await screen.findByText('Something went wrong.')).toBeTruthy();
    const today = screen.getByRole('list', { name: /^Today, / });
    expect(within(today).getByRole('button', { name: 'Edit Feeding, 08:00' })).toBeTruthy();
    vi.restoreAllMocks();
  });
});
