import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BabyRoutineDb } from '../db/database';
import { createEvent } from '../db/eventCommands';
import type { BabyEvent } from '../db/models';
import { DayPage } from '../pages/DayPage';
import { BABY_ID, testDatabase } from '../test/fakeApi';
import { useTestLocale } from '../test/locale';
import { renderUi } from '../test/renderUi';
import { renderWithDb } from '../test/renderApp';
import { DIAPER, seedBaby } from '../test/seed';
import { DIAPER_TYPE } from '../test/builtInTypes';
import { DeleteRequestBanner } from './DeleteRequestBanner';
import { EventSheet } from './EventSheet';

/*
 * "Alexa asked to delete this entry" (docs/design/32-assistants.md "Assistants never delete"): the
 * assistant only marks the entry; the person deletes it (the usual soft delete) or keeps it (the
 * marks go, the origin stays). Viewers see the banner without the buttons.
 */

let db: BabyRoutineDb;

const asked = {
  content: 'WET',
  via: 'alexa',
  delete_requested_via: 'alexa',
  delete_requested_at: '2026-10-20T14:00:00.000Z',
};

beforeEach(() => {
  db = testDatabase();
});

afterEach(async () => {
  await db.delete();
  await useTestLocale('en');
});

async function requested(payload: BabyEvent['payload'] = asked) {
  return createEvent(db, {
    babyId: BABY_ID,
    typeId: DIAPER,
    startedAt: new Date(Date.now() - 10 * 60_000).toISOString(),
    endedAt: new Date(Date.now() - 10 * 60_000).toISOString(),
    payload,
  });
}

describe.each([
  [
    'en',
    {
      alexa: 'Alexa asked to delete this entry',
      mcp: 'An AI assistant asked to delete this entry',
      del: 'Delete',
      keep: 'Keep',
    },
  ],
  [
    'pt-BR',
    {
      alexa: 'A Alexa pediu para apagar este registro',
      mcp: 'Um assistente de IA pediu para apagar este registro',
      del: 'Apagar',
      keep: 'Manter',
    },
  ],
] as const)('the banner in %s', (locale, text) => {
  it('names who asked and offers Delete and Keep only with handlers', async () => {
    await useTestLocale(locale);
    const onDelete = vi.fn();
    const onKeep = vi.fn();
    const { unmount } = renderUi(
      <DeleteRequestBanner
        event={{ payload: { delete_requested_via: 'alexa' } }}
        onDelete={onDelete}
        onKeep={onKeep}
      />,
    );
    expect(screen.getByText(text.alexa)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: text.del }));
    fireEvent.click(screen.getByRole('button', { name: text.keep }));
    expect([onDelete.mock.calls.length, onKeep.mock.calls.length]).toEqual([1, 1]);
    unmount();

    const second = renderUi(
      <DeleteRequestBanner event={{ payload: { delete_requested_via: 'mcp' } }} />,
    );
    expect(screen.getByText(text.mcp)).toBeTruthy();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    second.unmount();

    renderUi(<DeleteRequestBanner event={{ payload: { via: 'alexa' } }} />);
    expect(screen.queryByTestId('delete-request')).toBeNull();
  });
});

describe('the day list', () => {
  it('Delete soft-deletes the entry with the usual path, and Keep clears only the request', async () => {
    await seedBaby(db);
    const first = await requested();
    const second = await requested();
    renderWithDb(db, <DayPage />);

    const banners = await screen.findAllByTestId('delete-request');
    expect(banners).toHaveLength(2);
    fireEvent.click(within(banners[0]!).getByRole('button', { name: 'Keep' }));
    await waitFor(() => expect(screen.getAllByTestId('delete-request')).toHaveLength(1));
    const afterKeep = [(await db.events.get(first.id))!, (await db.events.get(second.id))!];
    const kept = afterKeep.find((event) => !('delete_requested_via' in event.payload))!;
    const pending = afterKeep.find((event) => 'delete_requested_via' in event.payload)!;
    expect(kept.payload).toEqual({ content: 'WET', via: 'alexa' });
    expect([kept.deletedAt, pending.deletedAt]).toEqual([null, null]);

    fireEvent.click(
      within(screen.getByTestId('delete-request')).getByRole('button', { name: 'Delete' }),
    );
    await waitFor(async () => expect((await db.events.get(pending.id))?.deletedAt).not.toBeNull());
    expect((await db.events.get(pending.id))?.payload).toMatchObject({ via: 'alexa' });
    expect((await db.events.get(kept.id))?.deletedAt).toBeNull();
  });

  it('shows a Viewer the banner without the buttons', async () => {
    await seedBaby(db, { role: 'Viewer' });
    const entry = await requested();
    renderWithDb(db, <DayPage />);

    const banner = await screen.findByTestId('delete-request');
    expect(within(banner).queryAllByRole('button')).toHaveLength(0);
    expect(screen.getByText('Alexa asked to delete this entry')).toBeTruthy();
    expect((await db.events.get(entry.id))?.deletedAt).toBeNull();
  });
});

describe('the event sheet', () => {
  it('Keep removes the two marks and closes; the origin note stays', async () => {
    await seedBaby(db);
    await db.eventTypes.put(DIAPER_TYPE);
    const entry = await requested();
    const onDone = vi.fn();
    renderWithDb(
      db,
      <EventSheet babyId={BABY_ID} types={[DIAPER_TYPE]} event={entry} onDone={onDone} />,
    );

    expect(await screen.findByText('Alexa asked to delete this entry')).toBeTruthy();
    fireEvent.click(
      within(screen.getByTestId('delete-request')).getByRole('button', { name: 'Keep' }),
    );

    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect((await db.events.get(entry.id))?.payload).toEqual({ content: 'WET', via: 'alexa' });
  });

  it('Delete is the normal delete', async () => {
    await seedBaby(db);
    await db.eventTypes.put(DIAPER_TYPE);
    const entry = await requested();
    const onDone = vi.fn();
    renderWithDb(
      db,
      <EventSheet babyId={BABY_ID} types={[DIAPER_TYPE]} event={entry} onDone={onDone} />,
    );

    fireEvent.click(
      within(await screen.findByTestId('delete-request')).getByRole('button', { name: 'Delete' }),
    );

    await waitFor(async () => expect((await db.events.get(entry.id))?.deletedAt).not.toBeNull());
  });
});
