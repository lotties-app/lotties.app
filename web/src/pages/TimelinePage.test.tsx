import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BabyRoutineDb } from '../db/database';
import { createEvent } from '../db/eventCommands';
import type { BabyEvent } from '../db/models';
import { BABY_ID, testDatabase } from '../test/fakeApi';
import { renderWithDb } from '../test/renderApp';
import { BELLY, DIAPER, FEEDING, MEDICATION, seedBaby } from '../test/seed';
import { TimelinePage } from './TimelinePage';

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
    .getAllByRole('button')
    .map((b) => b.getAttribute('aria-label'));

describe('TimelinePage', () => {
  it('groups the last 14 days by local day, newest first, with summaries', async () => {
    await seedEvents();
    renderWithDb(db, <TimelinePage />);

    const today = await screen.findByRole('list', { name: 'Today' });
    const yesterday = screen.getByRole('list', { name: 'Yesterday' });
    expect(rowNames(today)).toEqual(['Edit Feeding', 'Edit Belly pain']);
    expect(rowNames(yesterday)).toEqual(['Edit Diaper']);
    expect(within(today).getByText('08:00 – 08:45 · 45 min')).toBeTruthy();
    expect(within(today).getByText('07:00 · Intensity 3/5')).toBeTruthy();
    expect(within(yesterday).getByText('20:00 · DIRTY')).toBeTruthy();
    expect(screen.queryByText(/WET/)).toBeNull();
  });

  it('loads 14 more days on "Load older"', async () => {
    await seedEvents();
    renderWithDb(db, <TimelinePage />);

    fireEvent.click(await screen.findByRole('button', { name: 'Load older' }));

    expect(await screen.findByText('09:00 · WET')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Load older' })).toBeNull();
  });

  it('filters by event type chips', async () => {
    await seedEvents();
    renderWithDb(db, <TimelinePage />);
    const filters = await screen.findByRole('group', { name: 'Filter by type' });

    fireEvent.click(within(filters).getByRole('button', { name: /Diaper/ }));
    await waitFor(() => expect(screen.queryByRole('list', { name: 'Today' })).toBeNull());
    expect(screen.getByRole('list', { name: 'Yesterday' })).toBeTruthy();

    fireEvent.click(within(filters).getByRole('button', { name: 'All' }));
    expect(await screen.findByRole('list', { name: 'Today' })).toBeTruthy();
  });

  it('marks running events and unsynced / failed rows', async () => {
    await seedBaby(db);
    const running = await createEvent(db, {
      babyId: BABY_ID,
      typeId: FEEDING,
      startedAt: at(0, 0, 1),
    });
    const failed = await createEvent(db, {
      babyId: BABY_ID,
      typeId: MEDICATION,
      startedAt: at(0, 0),
      endedAt: at(0, 0),
      payload: { medications: [{ medicationId: 'm1', name: 'Colidis' }] },
    });
    await db.outbox.where('entityId').equals(failed.id).modify({ status: 'dead' });
    renderWithDb(db, <TimelinePage />);

    const today = await screen.findByRole('list', { name: 'Today' });
    const [runningRow, failedRow] = within(today).getAllByRole('button');
    expect(within(runningRow).getByText('Running')).toBeTruthy();
    expect(within(runningRow).getByText('Since 00:01')).toBeTruthy();
    expect(within(runningRow).getByRole('img', { name: 'Not synced yet' })).toBeTruthy();
    expect(within(failedRow).getByText('00:00 · Colidis')).toBeTruthy();
    expect(within(failedRow).getByRole('img', { name: 'Sync failed' })).toBeTruthy();
    expect(running.id).not.toBe(failed.id);
  });

  it('opens the edit sheet when a row is tapped', async () => {
    await seedEvents();
    renderWithDb(db, <TimelinePage />);

    fireEvent.click(await screen.findByRole('button', { name: 'Edit Feeding' }));

    expect(await screen.findByRole('heading', { name: 'Edit event' })).toBeTruthy();
  });

  it('shows the sync status', async () => {
    await seedEvents();
    renderWithDb(db, <TimelinePage />);

    expect(await screen.findByRole('status', { name: 'Sync status: Synced' })).toBeTruthy();
  });

  it('contains a malformed record to its day group (review #5)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await seedEvents();
    // A corrupted custom type whose `fields` is not a list makes its rows throw while rendering.
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
    renderWithDb(db, <TimelinePage />);

    expect(await screen.findByText('Something went wrong.')).toBeTruthy();
    expect(screen.queryByRole('list', { name: 'Today' })).toBeNull();
    const yesterday = await screen.findByRole('list', { name: 'Yesterday' });
    expect(within(yesterday).getByRole('button', { name: 'Edit Diaper' })).toBeTruthy();
    vi.restoreAllMocks();
  });
});
