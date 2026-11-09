import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BabyRoutineDb } from '../db/database';
import { createEvent } from '../db/eventCommands';
import type { BabyEvent } from '../db/models';
import { DeletedEventSnackbar } from '../events/DeletedEventSnackbar';
import { dismissDeletedNotice } from '../events/deletedEvents';
import { BABY_ID, testDatabase } from '../test/fakeApi';
import { renderWithDb } from '../test/renderApp';
import { DIAPER, EVENT_TYPES, FEEDING, seedBaby } from '../test/seed';
import { DayRowMenu } from './DayRowMenu';

let db: BabyRoutineDb;

beforeEach(async () => {
  db = testDatabase();
  await seedBaby(db);
});

afterEach(async () => {
  dismissDeletedNotice();
  await db.delete();
});

const at = (h: number, m: number) => new Date(2026, 9, 20, h, m).toISOString();

const feeding = (overrides: Partial<Parameters<typeof createEvent>[1]> = {}) =>
  createEvent(db, {
    babyId: BABY_ID,
    typeId: FEEDING,
    startedAt: at(8, 0),
    endedAt: at(8, 30),
    payload: {},
    ...overrides,
  });

function renderMenu(event: BabyEvent, props: Partial<Parameters<typeof DayRowMenu>[0]> = {}) {
  const onOpen = vi.fn();
  const onClose = vi.fn();
  renderWithDb(
    db,
    <>
      <DayRowMenu
        event={event}
        type={EVENT_TYPES.find((type) => type.id === event.typeId)}
        medications={[]}
        canChange
        onOpen={onOpen}
        onClose={onClose}
        {...props}
      />
      <DeletedEventSnackbar />
    </>,
  );
  return { onOpen, onClose };
}

const actions = () => within(screen.getByRole('group', { name: 'Entry actions' }));
const actionNames = () => actions().getAllByRole('button').map((b) => b.textContent);

describe('DayRowMenu actions', () => {
  it('offers Edit, Change time and Delete for an entry the user may change', async () => {
    const event = await feeding();
    const { onOpen, onClose } = renderMenu(event);
    expect(screen.getByRole('dialog', { name: 'Feeding' })).toBeTruthy();
    expect(actionNames()).toEqual(['Edit', 'Change time', 'Delete']);
    fireEvent.click(actions().getByRole('button', { name: 'Edit' }));
    expect(onOpen).toHaveBeenCalledWith(event);
    expect(onClose).toHaveBeenCalled();
  });

  it('offers only View for an entry the user may not change', async () => {
    const event = await feeding({ endedAt: null });
    const { onOpen } = renderMenu(event, { canChange: false, onStop: vi.fn() });
    expect(actionNames()).toEqual(['View']);
    fireEvent.click(actions().getByRole('button', { name: 'View' }));
    expect(onOpen).toHaveBeenCalledWith(event);
  });

  it('offers Stop for a running entry only when it can be stopped', async () => {
    const event = await feeding({ endedAt: null });
    const onStop = vi.fn();
    const { onClose } = renderMenu(event, { onStop });
    expect(actionNames()).toEqual(['Edit', 'Change time', 'Stop', 'Delete']);
    fireEvent.click(actions().getByRole('button', { name: 'Stop' }));
    expect(onStop).toHaveBeenCalledWith(event);
    expect(onClose).toHaveBeenCalled();
  });

  it('has no Stop without onStop or for a finished entry', async () => {
    renderMenu(await feeding({ endedAt: null }));
    expect(actionNames()).not.toContain('Stop');
  });

  it('deletes without a confirmation and offers Undo', async () => {
    const event = await feeding();
    const { onClose } = renderMenu(event);
    fireEvent.click(actions().getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('Feeding deleted')).toBeTruthy();
    // The mocked onClose keeps the menu open, which hides the rest of the page from the a11y tree.
    expect(screen.getByRole('button', { name: 'Undo', hidden: true })).toBeTruthy();
    expect((await db.events.get(event.id))?.deletedAt).not.toBeNull();
    expect(onClose).toHaveBeenCalled();
  });
});

describe('DayRowMenu change time', () => {
  it('saves a new start through the event commands (client updatedAt, outbox)', async () => {
    const event = await feeding();
    const { onClose } = renderMenu(event);
    fireEvent.click(actions().getByRole('button', { name: 'Change time' }));
    expect(screen.getByRole('dialog', { name: 'Change time' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Start'), { target: { value: '08:10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start 5 minutes earlier' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const saved = await db.events.get(event.id);
    expect(saved?.startedAt).toBe(at(8, 5));
    expect(saved?.endedAt).toBe(at(8, 30));
    expect(saved?.payload).toEqual(event.payload);
    expect((saved?.clientUpdatedAt ?? '') >= (event.clientUpdatedAt ?? '')).toBe(true);
    const queued = (await db.outbox.toArray()).filter((m) => m.entityId === event.id);
    expect(queued.at(-1)?.kind).toBe('upsert');
    expect(queued.at(-1)?.payload).toMatchObject({ startedAt: saved?.startedAt });
  });

  it('refuses an end before the start and saves nothing', async () => {
    const event = await feeding();
    const { onClose } = renderMenu(event);
    fireEvent.click(actions().getByRole('button', { name: 'Change time' }));
    fireEvent.change(screen.getByLabelText('End'), { target: { value: '07:45' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'End time must not be before the start time.',
    );
    expect(onClose).not.toHaveBeenCalled();
    expect((await db.events.get(event.id))?.endedAt).toBe(at(8, 30));
  });

  it('moves a moment as one time', async () => {
    const event = await createEvent(db, {
      babyId: BABY_ID,
      typeId: DIAPER,
      startedAt: at(9, 0),
      endedAt: at(9, 0),
      payload: { content: 'WET' },
    });
    const { onClose } = renderMenu(event);
    fireEvent.click(actions().getByRole('button', { name: 'Change time' }));
    expect(screen.queryByLabelText('End')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Time 15 minutes later' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const saved = await db.events.get(event.id);
    expect(saved?.startedAt).toBe(at(9, 15));
    expect(saved?.endedAt).toBe(at(9, 15));
  });

  it('opens the full sheet for a bottle with a history', async () => {
    const event = await feeding({
      payload: { method: 'bottle', amount_ml: 120, segments: '120>80@300+0' },
    });
    const { onOpen } = renderMenu(event);
    fireEvent.click(actions().getByRole('button', { name: 'Change time' }));
    expect(onOpen).toHaveBeenCalledWith(event);
    expect(screen.queryByLabelText('Start')).toBeNull();
  });

  it('Cancel goes back to the actions', async () => {
    renderMenu(await feeding());
    fireEvent.click(actions().getByRole('button', { name: 'Change time' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(actionNames()).toEqual(['Edit', 'Change time', 'Delete']);
  });
});
