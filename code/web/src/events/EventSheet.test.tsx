import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import axe from 'axe-core';
import type { BabyRoutineDb } from '../db/database';
import { createEvent } from '../db/eventCommands';
import { fromEventTypeDto } from '../sync/contract';
import {
  BELLY_MASSAGE_TYPE,
  FEEDING_DTO,
  FEEDING_TYPE,
  NASAL_SUCTION_TYPE,
  SLEEP_TYPE,
} from '../test/builtInTypes';
import { BABY_ID, testDatabase } from '../test/fakeApi';
import { renderWithDb } from '../test/renderApp';
import { DIAPER, EVENT_TYPES, FEEDING, MEDICATION, seedBaby } from '../test/seed';
import { DeletedEventSnackbar } from './DeletedEventSnackbar';
import { dismissDeletedNotice } from './deletedEvents';
import { EventSheet } from './EventSheet';
import { recordLastUsed } from './lastUsedValues';

let db: BabyRoutineDb;

beforeEach(async () => {
  db = testDatabase();
  await seedBaby(db, { medications: true });
});

afterEach(async () => {
  dismissDeletedNotice();
  await db.delete();
});

function renderSheet(props: Partial<Parameters<typeof EventSheet>[0]> = {}) {
  const onDone = vi.fn();
  renderWithDb(
    db,
    <>
      <EventSheet babyId={BABY_ID} types={EVENT_TYPES} onDone={onDone} {...props} />
      <DeletedEventSnackbar />
    </>,
  );
  return onDone;
}

const quick = (panel: number) =>
  within(screen.getAllByRole('group', { name: 'Quick times' })[panel]);
const save = () => fireEvent.click(screen.getByRole('button', { name: 'Save' }));
const MINUTE = 60_000;

describe('EventSheet header', () => {
  it('names the dialog by the type and says the event starts now', () => {
    renderSheet({ initialTypeId: DIAPER });
    expect(screen.getByRole('dialog', { name: 'Diaper' })).toBeTruthy();
    expect(screen.getByText('Starting now')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'More actions' })).toBeNull();
  });

  it('shows when an edited event was logged and offers the overflow menu', async () => {
    const event = await createEvent(db, {
      babyId: BABY_ID,
      typeId: DIAPER,
      startedAt: new Date(2026, 9, 20, 6, 34).toISOString(),
      endedAt: new Date(2026, 9, 20, 6, 34).toISOString(),
      payload: { content: 'WET' },
    });
    renderSheet({ event });
    expect(screen.getByText('Logged 06:34')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    expect(await screen.findByRole('menuitem', { name: 'Delete' })).toBeTruthy();
  });

  it('has no axe violation on the dialog name', async () => {
    renderSheet({ initialTypeId: DIAPER });
    const results = await axe.run(screen.getByRole('dialog'), { runOnly: ['aria-dialog-name'] });
    expect(results.violations).toEqual([]);
  });
});

describe('EventSheet times', () => {
  it('rejects an end before the start under the End field and saves nothing', async () => {
    renderSheet({ initialTypeId: FEEDING });
    fireEvent.click(quick(0).getByRole('button', { name: '30 min ago' }));
    // Ends 5 minutes ago, then the start moves to now: the end precedes the start.
    fireEvent.click(screen.getByRole('switch', { name: 'Still running' }));
    fireEvent.click(quick(1).getByRole('button', { name: '5 min ago' }));
    fireEvent.click(quick(0).getByRole('button', { name: 'Now' }));
    save();

    expect(await screen.findAllByText('End time must not be before the start time.')).toBeTruthy();
    expect(await db.events.count()).toBe(0);
  });

  it('saves a timer started 30 minutes ago and still running, with UTC timestamps', async () => {
    const onDone = renderSheet({ initialTypeId: FEEDING });
    const before = Date.now();
    fireEvent.click(quick(0).getByRole('button', { name: '30 min ago' }));
    save();

    await waitFor(() => expect(onDone).toHaveBeenCalled());
    const [saved] = await db.events.toArray();
    expect(saved.endedAt).toBeNull();
    const started = Date.parse(saved.startedAt);
    expect(Math.abs(before - 30 * MINUTE - started)).toBeLessThan(2 * MINUTE);
  });

  it('shows the live duration between start and end', () => {
    renderSheet({ initialTypeId: FEEDING });
    fireEvent.click(quick(0).getByRole('button', { name: '30 min ago' }));
    fireEvent.click(screen.getByRole('switch', { name: 'Still running' }));
    expect(screen.getByText(/Duration 3\dm|Duration 2\dm/)).toBeTruthy();
  });
});

describe('EventSheet fields and problems', () => {
  it('logs an instant event from the choice and remembers nothing it was not given', async () => {
    const onDone = renderSheet({ initialTypeId: DIAPER });
    fireEvent.click(screen.getByRole('radio', { name: 'Dirty' }));
    save();
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    const [saved] = await db.events.toArray();
    expect(saved.payload).toEqual({ content: 'DIRTY' });
    expect(saved.endedAt).toBe(saved.startedAt);
  });

  it('shows the problem under the field, moves focus there and announces it', async () => {
    renderSheet({ initialTypeId: DIAPER });
    save();
    expect(await screen.findByText('Content is required.')).toBeTruthy();
    expect(screen.getByRole('status', { name: '' }).textContent).toBeDefined();
    expect(screen.getByText('1 thing to fix: Content is required.')).toBeTruthy();
    expect(screen.getByRole('radiogroup', { name: /Content/ }).getAttribute('aria-invalid')).toBe(
      'true',
    );
    await waitFor(() => {
      const radios = screen.getAllByRole('radio');
      expect(radios).toContain(document.activeElement);
    });
    expect(await db.events.count()).toBe(0);
  });

  it('never pre-selects a diaper content, but pre-selects the last method of a feeding', async () => {
    recordLastUsed(BABY_ID, FEEDING_TYPE, { method: 'bottle', amount_ml: 90 });
    renderSheet({ types: [FEEDING_TYPE], initialTypeId: FEEDING_TYPE.id });
    expect(screen.getByRole('radio', { name: 'Bottle' }).getAttribute('aria-checked')).toBe('true');
  });
});

describe('EventSheet medication', () => {
  it('lists usual medications first, then by name', async () => {
    renderSheet({ initialTypeId: MEDICATION });
    await screen.findByRole('checkbox', { name: /Alpha tablet/ });
    const names = screen.getAllByRole('checkbox').map((c) => c.textContent);
    expect(names).toEqual(['Alpha tabletUsual', 'Zeta syrupUsual', 'Beta drops']);
  });

  it('saves the selected medications with their default doses and requires a selection', async () => {
    const onDone = renderSheet({ initialTypeId: MEDICATION });
    save();
    expect(await screen.findByText('Select at least one medication.')).toBeTruthy();

    fireEvent.click(await screen.findByRole('checkbox', { name: /Zeta syrup/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Alpha tablet/ }));
    save();

    await waitFor(() => expect(onDone).toHaveBeenCalled());
    const [saved] = await db.events.toArray();
    expect(saved.payload).toEqual({
      medications: [
        { medicationId: 'm-z', name: 'Zeta syrup', dose: { amount: 2.5, unit: 'ml' } },
        { medicationId: 'm-a', name: 'Alpha tablet' },
      ],
    });
  });
});

describe('EventSheet editing, deleting and discarding', () => {
  async function finishedFeeding() {
    return createEvent(db, {
      babyId: BABY_ID,
      typeId: FEEDING,
      startedAt: '2026-10-20T08:00:00.000Z',
      endedAt: '2026-10-20T08:10:00.000Z',
    });
  }

  it('edits a finished event', async () => {
    const event = await finishedFeeding();
    const onDone = renderSheet({ event });
    fireEvent.click(screen.getByRole('button', { name: 'Add a note' }));
    fireEvent.change(screen.getByLabelText('Note'), { target: { value: 'fussy' } });
    save();
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect((await db.events.get(event.id))?.notes).toBe('fussy');
  });

  it('deletes without a confirmation and offers Undo, which writes the event again', async () => {
    const event = await finishedFeeding();
    const onDone = renderSheet({ event });
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete' }));

    await waitFor(async () => expect((await db.events.get(event.id))?.deletedAt).not.toBeNull());
    expect(onDone).toHaveBeenCalledTimes(1);
    // The mock `onDone` leaves the sheet open, so the notice sits behind its modal.
    expect(await screen.findByText('Feeding deleted')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Undo', hidden: true }));
    await waitFor(async () => {
      const live = (await db.events.toArray()).filter((e) => e.deletedAt === null);
      expect(live).toHaveLength(1);
      expect(live[0]).toMatchObject({ startedAt: event.startedAt, endedAt: event.endedAt });
    });
  });

  it('closes at once when nothing changed', () => {
    const onDone = renderSheet({ initialTypeId: DIAPER });
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('asks before discarding changes, in the footer and not in a modal', async () => {
    const onDone = renderSheet({ initialTypeId: DIAPER });
    fireEvent.click(screen.getByRole('radio', { name: 'Wet' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(await screen.findByText('Discard your changes?')).toBeTruthy();
    expect(onDone).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(screen.queryByText('Discard your changes?')).toBeNull();
    expect(screen.getByRole('radio', { name: 'Wet' }).getAttribute('aria-checked')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Discard' }));
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(await db.events.count()).toBe(0);
  });
});

describe('EventSheet change of type', () => {
  it('keeps what fits, says so, and Undo brings the old form back', async () => {
    renderSheet({ types: [FEEDING_TYPE, SLEEP_TYPE], initialTypeId: FEEDING_TYPE.id });
    fireEvent.click(screen.getByRole('radio', { name: 'Bottle' }));
    expect(await screen.findByText('Bottle content')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Feeding' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Sleep' }));
    expect(
      await screen.findByText("Changed to Sleep. Details that don't apply were cleared."),
    ).toBeTruthy();
    expect(screen.getByRole('dialog', { name: 'Sleep' })).toBeTruthy();
    expect(screen.queryByText('Bottle content')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(await screen.findByText('Bottle content')).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Bottle' }).getAttribute('aria-checked')).toBe('true');
  });
});

describe('EventSheet nasal suction', () => {
  const renderSuction = () =>
    renderSheet({
      types: [NASAL_SUCTION_TYPE, FEEDING_TYPE],
      initialTypeId: NASAL_SUCTION_TYPE.id,
    });

  it('offers the optional tool choices and the saline switch', () => {
    renderSuction();
    expect(screen.getByRole('dialog', { name: 'Nasal suction' })).toBeTruthy();
    for (const tool of ['Bulb', 'Electric', 'Mouth suction']) {
      expect(screen.getByRole('radio', { name: tool })).toBeTruthy();
    }
    expect(screen.getByRole('switch', { name: 'Saline used' })).toBeTruthy();
    expect(screen.queryByRole('switch', { name: 'Still running' })).toBeNull();
  });

  it('logs an instant event with the tool and saline', async () => {
    const onDone = renderSuction();
    fireEvent.click(screen.getByRole('radio', { name: 'Bulb' }));
    fireEvent.click(screen.getByRole('switch', { name: 'Saline used' }));
    save();
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    const [saved] = await db.events.toArray();
    expect(saved.typeId).toBe(NASAL_SUCTION_TYPE.id);
    expect(saved.payload).toEqual({ tool: 'bulb', saline: true });
    expect(saved.endedAt).toBe(saved.startedAt);
  });

  it('logs without any detail, since every field is optional', async () => {
    const onDone = renderSuction();
    save();
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    const [saved] = await db.events.toArray();
    expect(saved.payload.tool).toBeUndefined();
    expect(saved.payload.saline).not.toBe(true);
  });
});

describe('EventSheet belly massage', () => {
  const renderMassage = () =>
    renderSheet({
      types: [BELLY_MASSAGE_TYPE, FEEDING_TYPE],
      initialTypeId: BELLY_MASSAGE_TYPE.id,
    });

  it('offers the optional reasons, whether it helped, and a running timer', () => {
    renderMassage();
    expect(screen.getByRole('dialog', { name: 'Belly massage' })).toBeTruthy();
    for (const option of ['Gas', 'Constipation', 'Colic', 'Other', 'Yes', 'A little', 'No']) {
      expect(screen.getByRole('radio', { name: option })).toBeTruthy();
    }
    expect(screen.getByText('Reason')).toBeTruthy();
    expect(screen.getByText('Did it help?')).toBeTruthy();
    expect(screen.getByRole('switch', { name: 'Still running' })).toBeTruthy();
    expect(screen.queryByText('Pauses')).toBeNull();
  });

  it('logs the reason and whether it helped', async () => {
    const onDone = renderMassage();
    fireEvent.click(screen.getByRole('radio', { name: 'Gas' }));
    fireEvent.click(screen.getByRole('radio', { name: 'A little' }));
    save();
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    const [saved] = await db.events.toArray();
    expect(saved.typeId).toBe(BELLY_MASSAGE_TYPE.id);
    expect(saved.payload).toEqual({ reason: 'gas', helped: 'a_little' });
  });
});

describe('EventSheet conditional fields (visibleWhen)', () => {
  const types = [FEEDING_TYPE, SLEEP_TYPE];
  const renderFeeding = (props: Partial<Parameters<typeof EventSheet>[0]> = {}) =>
    renderSheet({ types, initialTypeId: FEEDING_TYPE.id, ...props });

  it('shows only the method until one is chosen, then only the fields of that method', async () => {
    renderFeeding();
    expect(screen.getByRole('radio', { name: 'Breast' })).toBeTruthy();
    for (const label of ['Side', 'Amount', 'Bottle content', 'Food']) {
      expect(screen.queryByText(label)).toBeNull();
    }

    fireEvent.click(screen.getByRole('radio', { name: 'Breast' }));
    expect(await screen.findByText('Side')).toBeTruthy();
    expect(screen.getByText('Left breast')).toBeTruthy();
    expect(screen.getByText('Right breast')).toBeTruthy();
    expect(screen.queryByText('Amount prepared')).toBeNull();

    fireEvent.click(screen.getByRole('radio', { name: 'Solid food' }));
    expect(await screen.findByLabelText(/Food/)).toBeTruthy();
    await waitFor(() => expect(screen.queryByText('Side')).toBeNull());
  });

  it('offers quick amounts from the recent bottles and marks the last used one', async () => {
    for (const hoursAgo of [3, 6, 9]) {
      const at = new Date(Date.now() - hoursAgo * 60 * MINUTE).toISOString();
      await createEvent(db, {
        babyId: BABY_ID,
        typeId: FEEDING_TYPE.id,
        startedAt: at,
        endedAt: at,
        payload: { method: 'bottle', amount_ml: 120 },
      });
    }
    recordLastUsed(BABY_ID, FEEDING_TYPE, { method: 'bottle', amount_ml: 100 });
    renderFeeding();
    expect(await screen.findByText('Amount prepared')).toBeTruthy();
    // Typical 120, topped up to 150 and 180, plus the remembered 100.
    expect(await screen.findByText('From your recent feeds')).toBeTruthy();
    for (const amount of ['120', '150', '180']) {
      expect(screen.getByRole('button', { name: new RegExp(`^${amount}`) })).toBeTruthy();
    }
    expect(screen.getByRole('button', { name: /^100.*last/ })).toBeTruthy();
  });

  it('drops the values of fields that become hidden and never sends them', async () => {
    const onDone = renderFeeding();
    fireEvent.click(screen.getByRole('radio', { name: 'Breast' }));
    fireEvent.click(await screen.findByRole('radio', { name: 'Left' }));

    fireEvent.click(screen.getByRole('radio', { name: 'Bottle' }));
    // Typed, not a chip: the chips follow the baby's age and history.
    fireEvent.change(await screen.findByRole('spinbutton', { name: /Amount prepared/ }), {
      target: { value: '90' },
    });
    fireEvent.click(screen.getByRole('radio', { name: 'Breast milk' }));
    save();

    await waitFor(() => expect(onDone).toHaveBeenCalled());
    const [saved] = await db.events.toArray();
    expect(saved.payload).toEqual({
      method: 'bottle',
      amount_ml: 90,
      bottle_feeding_type: 'breast_milk',
    });
  });

  it('switching back does not resurrect a dropped value', async () => {
    renderFeeding();
    fireEvent.click(screen.getByRole('radio', { name: 'Breast' }));
    fireEvent.click(await screen.findByRole('radio', { name: 'Left' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Bottle' }));
    await waitFor(() => expect(screen.queryByText('Side')).toBeNull());
    fireEvent.click(screen.getByRole('radio', { name: 'Breast' }));
    const left = await screen.findByRole('radio', { name: 'Left' });
    expect(left.getAttribute('aria-checked')).toBe('false');
  });

  it('requires only visible fields', async () => {
    const strict = fromEventTypeDto({
      ...FEEDING_DTO,
      id: 'type-strict',
      fields: FEEDING_DTO.fields!.map((f) => (f.key === 'food' ? { ...f, isRequired: true } : f)),
    });
    const onDone = renderSheet({ types: [strict], initialTypeId: strict.id });
    save();
    expect(await screen.findByText('Method is required.')).toBeTruthy();
    expect(screen.queryByText('Food is required.')).toBeNull();

    fireEvent.click(screen.getByRole('radio', { name: 'Solid food' }));
    save();
    expect(await screen.findByText('Food is required.')).toBeTruthy();

    fireEvent.click(screen.getByRole('radio', { name: 'Bottle' }));
    save();
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  it('removes a hidden value an older event still carries when it is saved', async () => {
    const event = await createEvent(db, {
      babyId: BABY_ID,
      typeId: FEEDING_TYPE.id,
      startedAt: '2026-10-20T08:00:00.000Z',
      endedAt: '2026-10-20T08:10:00.000Z',
      payload: { method: 'bottle', amount_ml: 60, side: 'left', imported: 'kept' },
    });
    const onDone = renderSheet({ types, event });
    save();
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect((await db.events.get(event.id))?.payload).toEqual({
      method: 'bottle',
      amount_ml: 60,
    });
  });

  it('never shows a raw option code for a built-in type', () => {
    const future = fromEventTypeDto({
      ...FEEDING_DTO,
      id: 'type-future',
      fields: [{ ...FEEDING_DTO.fields![0], options: ['breast', 'tube_feeding', 'FORMULA_MIX'] }],
    });
    renderSheet({ types: [future], initialTypeId: future.id });
    expect(screen.getByRole('radio', { name: 'Tube feeding' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Formula mix' })).toBeTruthy();
    expect(screen.queryByText(/tube_feeding|FORMULA_MIX/)).toBeNull();
  });

  it('collapses without animation when the user prefers reduced motion', async () => {
    const matchMedia = vi.fn((query: string) => ({
      matches: query.includes('prefers-reduced-motion'),
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    vi.stubGlobal('matchMedia', matchMedia);
    try {
      renderFeeding();
      fireEvent.click(screen.getByRole('radio', { name: 'Breast' }));
      expect(await screen.findByText('Side')).toBeTruthy();
      fireEvent.click(screen.getByRole('radio', { name: 'Bottle' }));
      await waitFor(() => expect(screen.queryByText('Side')).toBeNull(), { timeout: 50 });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
