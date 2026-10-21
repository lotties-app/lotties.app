import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BabyRoutineDb } from '../db/database';
import { createEvent } from '../db/eventCommands';
import { BABY_ID, testDatabase } from '../test/fakeApi';
import { renderWithDb } from '../test/renderApp';
import { EVENT_TYPES, FEEDING, MEDICATION, seedBaby } from '../test/seed';
import { fromEventTypeDto } from '../sync/contract';
import { FEEDING_DTO, FEEDING_TYPE, SLEEP_TYPE } from '../test/builtInTypes';
import axe from 'axe-core';
import { EventSheet } from './EventSheet';

let db: BabyRoutineDb;

beforeEach(async () => {
  db = testDatabase();
  await seedBaby(db, { medications: true });
});

afterEach(async () => {
  await db.delete();
});

function renderSheet(props: Partial<Parameters<typeof EventSheet>[0]> = {}) {
  const onDone = vi.fn();
  renderWithDb(db, <EventSheet babyId={BABY_ID} types={EVENT_TYPES} onDone={onDone} {...props} />);
  return onDone;
}

describe('EventSheet validation', () => {
  it('rejects an end before the start and saves nothing', async () => {
    renderSheet({ initialTypeId: FEEDING });
    fireEvent.change(screen.getByLabelText('Start'), { target: { value: '2026-10-20T10:00' } });
    fireEvent.change(screen.getByLabelText('End'), { target: { value: '2026-10-20T09:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('End time must not be before the start time.')).toBeTruthy();
    expect(await db.events.count()).toBe(0);
  });

  it('saves a finished duration event with UTC timestamps', async () => {
    const onDone = renderSheet({ initialTypeId: FEEDING });
    fireEvent.change(screen.getByLabelText('Start'), { target: { value: '2026-10-20T10:00' } });
    fireEvent.change(screen.getByLabelText('End'), { target: { value: '2026-10-20T10:20' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onDone).toHaveBeenCalled());
    const [saved] = await db.events.toArray();
    expect(saved.startedAt).toBe(new Date(2026, 9, 20, 10, 0).toISOString());
    expect(saved.endedAt).toBe(new Date(2026, 9, 20, 10, 20).toISOString());
  });
});

describe('EventSheet medication checklist', () => {
  it('lists usual medications first, then by name', async () => {
    renderSheet({ initialTypeId: MEDICATION });
    await screen.findByRole('checkbox', { name: 'Alpha tablet' });
    const names = screen.getAllByRole('checkbox').map((c) => c.getAttribute('aria-label'));
    expect(names).toEqual(['Alpha tablet', 'Zeta syrup', 'Beta drops']);
  });

  it('saves the selected medications with doses and requires a selection', async () => {
    const onDone = renderSheet({ initialTypeId: MEDICATION });
    fireEvent.click(await screen.findByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Select at least one medication.')).toBeTruthy();

    fireEvent.click(await screen.findByRole('checkbox', { name: 'Zeta syrup' }));
    expect((screen.getByLabelText('Zeta syrup dose') as HTMLInputElement).value).toBe('2.5');
    fireEvent.change(screen.getByLabelText('Zeta syrup dose'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Alpha tablet' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onDone).toHaveBeenCalled());
    const [saved] = await db.events.toArray();
    expect(saved.payload).toEqual({
      medications: [
        { medicationId: 'm-z', name: 'Zeta syrup', dose: { amount: 3, unit: 'ml' } },
        { medicationId: 'm-a', name: 'Alpha tablet' },
      ],
    });
  });

  it('adds a medication to the catalog inline and queues it in the outbox', async () => {
    renderSheet({ initialTypeId: MEDICATION });
    fireEvent.change(await screen.findByLabelText('New medication'), {
      target: { value: ' Gripe water ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add medication' }));

    const checkbox = await screen.findByRole('checkbox', { name: 'Gripe water' });
    expect((checkbox as HTMLInputElement).checked).toBe(true);
    const created = (await db.medications.toArray()).find((m) => m.name === 'Gripe water');
    expect(created).toMatchObject({ babyId: BABY_ID, isUsual: false });
    const queued = (await db.outbox.toArray()).filter((m) => m.entityType === 'medication');
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({ kind: 'upsert', entityId: created!.id });
  });
});

describe('EventSheet editing', () => {
  it('edits and soft-deletes an existing event after confirmation', async () => {
    const event = await createEvent(db, {
      babyId: BABY_ID,
      typeId: FEEDING,
      startedAt: '2026-10-20T08:00:00.000Z',
      endedAt: '2026-10-20T08:10:00.000Z',
    });
    const onDone = renderSheet({ event });

    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'fussy' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect((await db.events.get(event.id))?.notes).toBe('fussy');

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete event' }));
    await waitFor(async () => expect((await db.events.get(event.id))?.deletedAt).not.toBeNull());
    expect(onDone).toHaveBeenCalledTimes(2);
  });
});

describe('EventSheet conditional fields (visibleWhen)', () => {
  const types = [FEEDING_TYPE, SLEEP_TYPE];
  const renderFeeding = (props: Partial<Parameters<typeof EventSheet>[0]> = {}) =>
    renderSheet({ types, initialTypeId: FEEDING_TYPE.id, ...props });

  it('shows only the method until one is chosen, then only the fields of that method', async () => {
    renderFeeding();
    expect(screen.getByRole('button', { name: 'Breast' })).toBeTruthy();
    for (const label of ['Side', 'Amount', 'Bottle content', 'Food']) {
      expect(screen.queryByText(label)).toBeNull();
    }

    fireEvent.click(screen.getByRole('button', { name: 'Breast' }));
    expect(await screen.findByText('Side')).toBeTruthy();
    expect(screen.getByLabelText('Left breast')).toBeTruthy();
    expect(screen.getByLabelText('Right breast')).toBeTruthy();
    expect(screen.queryByLabelText('Amount')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Solid food' }));
    expect(await screen.findByLabelText('Food')).toBeTruthy();
    await waitFor(() => expect(screen.queryByText('Side')).toBeNull());
  });

  it('drops the values of fields that become hidden and never sends them', async () => {
    const onDone = renderFeeding();
    fireEvent.change(screen.getByLabelText('End'), { target: { value: '2099-01-01T00:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Breast' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Left' }));
    fireEvent.change(screen.getByLabelText('Left breast'), { target: { value: '300' } });

    fireEvent.click(screen.getByRole('button', { name: 'Bottle' }));
    fireEvent.change(await screen.findByLabelText('Amount'), { target: { value: '90' } });
    fireEvent.click(screen.getByRole('button', { name: 'Breast milk' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

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
    fireEvent.click(screen.getByRole('button', { name: 'Breast' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Left' }));
    fireEvent.click(screen.getByRole('button', { name: 'Bottle' }));
    await waitFor(() => expect(screen.queryByText('Side')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Breast' }));
    const left = await screen.findByRole('button', { name: 'Left' });
    expect(left.getAttribute('aria-pressed')).toBe('false');
  });

  it('requires only visible fields', async () => {
    const strict = fromEventTypeDto({
      ...FEEDING_DTO,
      id: 'type-strict',
      fields: FEEDING_DTO.fields!.map((f) => (f.key === 'food' ? { ...f, isRequired: true } : f)),
    });
    const onDone = renderSheet({ types: [strict], initialTypeId: strict.id });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Method is required.')).toBeTruthy();
    expect(screen.queryByText('Food is required.')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Solid food' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Food is required.')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Bottle' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
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
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect((await db.events.get(event.id))?.payload).toEqual({ method: 'bottle', amount_ml: 60 });
  });

  it('never shows a raw option code for a built-in type', async () => {
    const future = fromEventTypeDto({
      ...FEEDING_DTO,
      id: 'type-future',
      fields: [{ ...FEEDING_DTO.fields![0], options: ['breast', 'tube_feeding', 'FORMULA_MIX'] }],
    });
    renderSheet({ types: [future], initialTypeId: future.id });
    expect(screen.getByRole('button', { name: 'Tube feeding' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Formula mix' })).toBeTruthy();
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
      fireEvent.click(screen.getByRole('button', { name: 'Breast' }));
      expect(await screen.findByText('Side')).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Bottle' }));
      await waitFor(() => expect(screen.queryByText('Side')).toBeNull(), { timeout: 50 });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('names the sheet by its title', async () => {
    renderFeeding();
    const dialog = screen.getByRole('dialog', { name: 'Add event' });
    expect(dialog).toBeTruthy();
    const results = await axe.run(dialog, { runOnly: ['aria-dialog-name'] });
    expect(results.violations).toEqual([]);
  });
});
