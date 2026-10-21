import { useMemo } from 'react';
import { useDatabase } from '../db/DatabaseContext';
import type { BabyRoutineDb } from '../db/database';
import { deleteEvent, editEvent, pauseTimer, resumeTimer } from '../db/eventCommands';
import { EventNotFoundError } from '../db/errors';
import type { BabyEvent, EventPayload } from '../db/models';
import { announceEventDeleted } from '../events/deletedEvents';
import { switchSide } from '../now/nursing';
import { getOwn, setOwn, withoutOwn } from '../util/ownProperty';
import { SEGMENT_START_KEY } from './pauseMath';

/*
 * What the timer surfaces (mini bar, timer sheet, cards on Now) do to a running timer. Every
 * command writes locally (events + outbox) and so works offline; the sync engine pushes it later.
 * Payload edits read the stored event inside the transaction, so a pause or another edit that
 * happened a moment earlier is never overwritten by a stale copy held by the screen.
 */

export interface TimerCommands {
  pause: (id: string) => Promise<BabyEvent>;
  resume: (id: string) => Promise<BabyEvent>;
  /** Soft-deletes the timer and offers Undo (the shell's "deleted" snackbar). */
  discard: (event: BabyEvent, name: string) => Promise<void>;
  /** Moves the start (the caller keeps it before now); a nursing segment that began with it moves too. */
  adjustStart: (id: string, startedAt: string) => Promise<BabyEvent>;
  setNotes: (id: string, notes: string | null) => Promise<BabyEvent>;
  /** nap <-> night for a sleep timer. */
  switchSleepKind: (id: string) => Promise<BabyEvent>;
  /** Nursing: continue on the other side. */
  switchSide: (id: string) => Promise<unknown>;
  /** Sets one payload value (`null`/`''` removes it): the sleep detail fields. */
  setPayloadValue: (id: string, key: string, value: string | number | null) => Promise<BabyEvent>;
}

/** Edits the stored copy of an event: `change` gets the current event and returns the changes. */
async function editCurrent(
  db: BabyRoutineDb,
  id: string,
  change: (current: BabyEvent) => Parameters<typeof editEvent>[2],
): Promise<BabyEvent> {
  return db.transaction('rw', db.events, db.outbox, async () => {
    const current = await db.events.get(id);
    if (!current) throw new EventNotFoundError(id);
    return editEvent(db, id, change(current));
  });
}

/** The timer commands bound to the local database. */
export function useTimerCommands(): TimerCommands {
  const db = useDatabase();
  return useMemo(
    () => ({
      pause: (id) => pauseTimer(db, id),
      resume: (id) => resumeTimer(db, id),
      discard: async (event, name) => {
        await deleteEvent(db, event.id);
        announceEventDeleted(event, name);
      },
      adjustStart: (id, startedAt) =>
        editCurrent(db, id, (current) => {
          const payload: EventPayload = { ...current.payload };
          // A nursing session whose open segment began with it keeps its clocks in step.
          if (getOwn(payload, SEGMENT_START_KEY) === current.startedAt) {
            setOwn<unknown>(payload, SEGMENT_START_KEY, new Date(startedAt).toISOString());
          }
          return { startedAt, payload };
        }),
      setNotes: (id, notes) => editEvent(db, id, { notes }),
      switchSleepKind: (id) =>
        editCurrent(db, id, (current) => {
          const payload: EventPayload = { ...current.payload };
          setOwn<unknown>(
            payload,
            'kind',
            getOwn(current.payload, 'kind') === 'night' ? 'nap' : 'night',
          );
          return { payload };
        }),
      switchSide: (id) => switchSide(db, id),
      setPayloadValue: (id, key, value) =>
        editCurrent(db, id, (current) => {
          if (value === null || value === '') return { payload: withoutOwn(current.payload, key) };
          const payload: EventPayload = { ...current.payload };
          setOwn<unknown>(payload, key, value);
          return { payload };
        }),
    }),
    [db],
  );
}
