import type { BabyRoutineDb } from '../db/database';
import type { BabyEvent, EventPayload } from '../db/models';
import {
  createEvent,
  editEvent,
  finishEvent,
  stopEvent,
  type CommandOptions,
} from '../db/eventCommands';
import { eventsStartedSince, runningEvents } from '../db/queries';
import { planStop } from '../events/stopPlan';
import {
  deleteEventWithWakeUp,
  isNightSleep,
  wakeUpIdForStoppedNight,
} from '../now/nightEndsWakeUp';
import { startsSleep, stopFeedingForSleep } from '../now/sleepStopsFeeding';
import { eventMatchesPreset, inferFellAsleepKind } from './status';
import type { Preset } from './types';

/** Everything a preset command needs besides the preset. `options.now` is the tap moment. */
export interface PresetContext {
  babyId: string;
  options?: CommandOptions;
  /**
   * Payload of the tapped preset's event, instead of its `payloadDefaults` (e.g. the defaults plus
   * remembered values of required fields, see `quickStartPayload`).
   */
  payload?: EventPayload;
}

/** What a preset command changed, enough to undo it. */
export interface UndoToken {
  babyId: string;
  /** Events the command created. */
  createdIds: string[];
  /** Running timers the command stopped, with the end time it set. */
  stopped: { id: string; endedAt: string }[];
  /**
   * Running timers left running because stopping them needs details first (required fields the
   * server would ask for): the UI asks for them ("Finish this ...").
   */
  needsFinish?: string[];
  /** The command moment (UTC ISO); the time-shift chips move the events relative to it. */
  at?: string;
  /** Minutes the events were moved back from `at` by the time-shift chips (0 = not moved). */
  shiftMinutes?: number;
  /**
   * Events the command edited in place (e.g. a nursing side switch or stop), with their state
   * before the command and the edit stamp (`clientUpdatedAt`) the command left: undo restores
   * `before` only while the event still carries that stamp (nobody edited it since).
   */
  edited?: EditedEvent[];
}

export interface EditedEvent {
  id: string;
  before: Pick<BabyEvent, 'startedAt' | 'endedAt' | 'payload'>;
  stamp: string;
  /** The command stopped this running event (the time-shift chips then move its end). */
  stops?: boolean;
}

/** The tapped preset cannot run as a command (`sheet` and `link` presets open UI instead). */
export class PresetNotRunnableError extends Error {
  constructor(presetId: string) {
    super(`Preset ${presetId} does not run as a one-tap command.`);
    this.name = 'PresetNotRunnableError';
  }
}

/** A `timer` preset was tapped while its own timer already runs. */
export class PresetAlreadyRunningError extends Error {
  readonly eventId: string;

  constructor(presetId: string, eventId: string) {
    super(`Preset ${presetId} already has a running timer.`);
    this.name = 'PresetAlreadyRunningError';
    this.eventId = eventId;
  }
}

/** Sleep kinds a running timer can have; a missing kind (older timers) counts as a nap. */
const STOPPABLE_SLEEP_KINDS: readonly unknown[] = ['nap', 'night', undefined];

function isRunningSleepTimer(preset: Preset, event: BabyEvent) {
  const kind = Object.hasOwn(event.payload, 'kind') ? event.payload.kind : undefined;
  return (
    event.typeId === preset.typeId && event.endedAt === null && STOPPABLE_SLEEP_KINDS.includes(kind)
  );
}

/**
 * Runs a `timer` or `instant` preset as one local transaction (events + outbox entries):
 * - `timer`: starts the timer now; throws `PresetAlreadyRunningError` when it already runs;
 * - `instant`: logs the marker (`endedAt = startedAt`);
 * - Wake-up additionally stops every running nap/night timer at the same moment (one whose
 *   required fields are missing is left running and listed in `needsFinish`); its marker takes the
 *   stopped night's automatic wake-up id (`wakeUpIdForStoppedNight`);
 * - Fell asleep additionally starts a sleep timer (kind inferred, see `inferFellAsleepKind`),
 *   unless a nap/night timer already runs.
 * - Any nap/night timer that starts (the Nap preset, Fell asleep) also stops the running feeding
 *   timers at the same moment, marking them `ended_by: sleep` (see `stopFeedingForSleep`).
 * All events share the tap moment (`ctx.options.now`, default the current time).
 */
export async function runPreset(
  db: BabyRoutineDb,
  preset: Preset,
  ctx: PresetContext,
): Promise<UndoToken> {
  const typeId = preset.typeId;
  if (typeId === null || (preset.mode !== 'timer' && preset.mode !== 'instant')) {
    throw new PresetNotRunnableError(preset.id);
  }
  const when = ctx.options?.now?.() ?? new Date();
  const iso = when.toISOString();
  const options: CommandOptions = { ...ctx.options, now: () => when };
  const token: UndoToken = { babyId: ctx.babyId, createdIds: [], stopped: [] };

  const create = async (payload: EventPayload, instant: boolean, id?: string) => {
    const event = await createEvent(
      db,
      {
        babyId: ctx.babyId,
        typeId,
        startedAt: iso,
        endedAt: instant ? iso : null,
        payload,
      },
      id ? { ...options, newId: () => id } : options,
    );
    token.createdIds.push(event.id);
  };

  await db.transaction('rw', db.events, db.outbox, db.eventTypes, db.babies, async () => {
    const running = await runningEvents(db, ctx.babyId);

    // A sleep that starts ends the feeding timers that run (they are recorded for Undo).
    const stopFeeding = async () => {
      const stops = await stopFeedingForSleep(db, ctx.babyId, iso, options);
      if (stops.edited.length > 0) (token.edited ??= []).push(...stops.edited);
      if (stops.needsFinish.length > 0) (token.needsFinish ??= []).push(...stops.needsFinish);
    };

    if (preset.mode === 'timer') {
      const existing = running.find((e) => eventMatchesPreset(preset, e));
      if (existing) throw new PresetAlreadyRunningError(preset.id, existing.id);
    }

    // The Wake-up marker of a stopped night takes the night's automatic wake-up id (see
    // `nightEndsWakeUp`), so the night's stop never logs a second one.
    let markerId: string | undefined;
    if (preset.stopsSleepTimers) {
      const type = await db.eventTypes.get(typeId);
      for (const timer of running.filter((e) => isRunningSleepTimer(preset, e))) {
        const plan = planStop(type, timer.payload);
        if (plan.kind === 'finish') {
          (token.needsFinish ??= []).push(timer.id);
          continue;
        }
        const stopped =
          plan.kind === 'strip'
            ? await finishEvent(db, timer.id, plan.payload, iso, options)
            : await stopEvent(db, timer.id, iso, options);
        token.stopped.push({ id: timer.id, endedAt: stopped.endedAt ?? iso });
        if (markerId === undefined && isNightSleep(type, timer)) {
          markerId = await wakeUpIdForStoppedNight(db, timer.id);
        }
      }
    }

    const payload = { ...(ctx.payload ?? preset.payloadDefaults) };
    const sleepType = await db.eventTypes.get(typeId);
    if (preset.mode === 'timer' && startsSleep(sleepType, payload)) {
      await stopFeeding();
    }
    await create(payload, preset.mode === 'instant', markerId);

    if (preset.startsInferredSleepTimer && !running.some((e) => isRunningSleepTimer(preset, e))) {
      const recent = await eventsStartedSince(
        db,
        ctx.babyId,
        new Date(when.getTime() - 3 * 3_600_000).toISOString(),
      );
      await stopFeeding();
      await create({ kind: inferFellAsleepKind(recent, when) }, false);
    }
  });

  return token;
}

/**
 * Reverts `runPreset` (and the Now commands, which return the same token): soft-deletes the
 * created events, re-opens the stopped timers (only those still stopped at the time the command
 * set; a timer the user edited or deleted since is left alone) and restores edited events that
 * still carry the command's edit stamp. Events that no longer exist are skipped.
 */
export async function undoPreset(
  db: BabyRoutineDb,
  token: UndoToken,
  options: CommandOptions = {},
): Promise<void> {
  await db.transaction('rw', db.events, db.outbox, db.eventTypes, db.babies, async () => {
    for (const id of token.createdIds) {
      // Checked first: a failing nested command would abort this whole transaction. A created
      // night takes its automatic wake-up with it.
      if (await db.events.get(id)) await deleteEventWithWakeUp(db, id, options);
    }
    for (const { id, endedAt } of token.stopped) {
      const current = await db.events.get(id);
      if (current && current.deletedAt === null && current.endedAt === endedAt) {
        await editEvent(db, id, { endedAt: null }, options);
      }
    }
    for (const { id, before, stamp } of [...(token.edited ?? [])].reverse()) {
      const current = await db.events.get(id);
      if (current && current.deletedAt === null && current.clientUpdatedAt === stamp) {
        await editEvent(db, id, { ...before }, options);
      }
    }
  });
}

/** Values that prefill the existing event sheet for a `sheet` preset. */
export interface SheetPrefill {
  typeId: string;
  startedAt: string;
  /** `startedAt` for zero-length presets, else `null`. */
  endedAt: string | null;
  payload: EventPayload;
}

/** The event sheet prefill of a `sheet` preset: type, payload defaults and start = now. */
export function sheetPrefill(preset: Preset, now: Date = new Date()): SheetPrefill {
  if (preset.typeId === null || preset.mode !== 'sheet') {
    throw new PresetNotRunnableError(preset.id);
  }
  const startedAt = now.toISOString();
  return {
    typeId: preset.typeId,
    startedAt,
    endedAt: preset.endsImmediately ? startedAt : null,
    payload: { ...preset.payloadDefaults },
  };
}
