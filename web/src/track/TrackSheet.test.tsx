import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { Route, Routes, useLocation } from 'react-router-dom';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BabyRoutineDb } from '../db/database';
import { createEvent } from '../db/eventCommands';
import { BUILT_IN_PRESETS } from '../presets/catalogue';
import { fromEventTypeDto } from '../sync/contract';
import { BABY_ID, testDatabase } from '../test/fakeApi';
import { renderWithDb } from '../test/renderApp';
import { BREAST_PUMP_DTO, DIAPER_DTO, FEEDING_DTO, SLEEP_DTO } from '../test/builtInTypes';
import { BELLY, EVENT_TYPES } from '../test/seed';
import { TrackSheet } from './TrackSheet';

let db: BabyRoutineDb;
const BABY = { id: BABY_ID, name: 'Lia', birthDate: '2026-08-01', role: 'Owner' as const };

beforeEach(async () => {
  db = testDatabase();
  await db.babies.put(BABY);
  await db.eventTypes.bulkPut([
    ...[FEEDING_DTO, SLEEP_DTO, DIAPER_DTO, BREAST_PUMP_DTO].map(fromEventTypeDto),
    ...EVENT_TYPES.filter((t) => t.id === BELLY || t.key === 'medication'),
  ]);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await db.delete();
});

function Where() {
  const { pathname, hash } = useLocation();
  return <p>at {pathname + hash}</p>;
}

function Harness({ onClose }: { onClose: () => void }) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <button onClick={() => setOpen(true)}>open track</button>
      <TrackSheet
        open={open}
        onClose={() => {
          onClose();
          setOpen(false);
        }}
        baby={BABY}
      />
      <Routes>
        <Route path="*" element={<Where />} />
      </Routes>
    </>
  );
}

function renderTrack() {
  const onClose = vi.fn();
  renderWithDb(db, <Harness onClose={onClose} />);
  return onClose;
}

const sheet = () => screen.findByRole('dialog', { name: 'Track' });

describe('TrackSheet (interim, wired to the presets)', () => {
  it('lists every preset in catalogue order with its status line, as a named dialog', async () => {
    renderTrack();
    const dialog = await sheet();
    const names = within(dialog)
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
      'Start Pumping',
      'Log Diaper',
      'Log Medication',
      'Log Belly pain',
      'Custom',
    ]);
    expect(BUILT_IN_PRESETS.filter((p) => p.id !== 'bath' && p.id !== 'tummy_time')).toHaveLength(
      names.length,
    );
    expect(within(dialog).getAllByText('Not tracked today').length).toBeGreaterThan(5);
    const results = await axe.run(dialog, { runOnly: ['aria-dialog-name', 'button-name'] });
    expect(results.violations).toEqual([]);
  });

  it('logs an instant preset, closes, and undoes it from the snackbar', async () => {
    const onClose = renderTrack();
    fireEvent.click(within(await sheet()).getByRole('button', { name: /^Log Bedtime/ }));

    expect(onClose).toHaveBeenCalled();
    expect(await screen.findByText('Bedtime logged')).toBeTruthy();
    const [event] = await db.events.toArray();
    expect(event.payload).toEqual({ kind: 'bed_time' });

    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }));
    await waitFor(async () => expect((await db.events.get(event.id))?.deletedAt).not.toBeNull());
  });

  it('a tap on a running timer preset stops it, and Undo re-opens it', async () => {
    const nursing = await createEvent(db, {
      babyId: BABY_ID,
      typeId: FEEDING_DTO.id,
      payload: { method: 'breast' },
    });
    renderTrack();
    fireEvent.click(within(await sheet()).getByRole('button', { name: /^Stop Nursing, Running/ }));

    expect(await screen.findByText('Nursing stopped')).toBeTruthy();
    expect((await db.events.get(nursing.id))?.endedAt).not.toBeNull();
    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }));
    await waitFor(async () => expect((await db.events.get(nursing.id))?.endedAt).toBeNull());
  });

  it('opens the prefilled sheet of a sheet preset; belly pain requires its intensity', async () => {
    renderTrack();
    fireEvent.click(within(await sheet()).getByRole('button', { name: /^Log Belly pain/ }));

    expect(await screen.findByRole('heading', { name: 'Add event' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Intensity is required.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '4' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(async () => expect(await db.events.count()).toBe(1));
    const [saved] = await db.events.toArray();
    expect(saved).toMatchObject({ typeId: BELLY, payload: { intensity: 4 } });
  });

  it('the Custom tile opens the event type settings', async () => {
    renderTrack();
    fireEvent.click(within(await sheet()).getByRole('button', { name: 'Custom' }));
    expect(await screen.findByText('at /settings#event-types')).toBeTruthy();
  });
});
