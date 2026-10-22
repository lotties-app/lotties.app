import type { BabyRoutineDb } from '../db/database';
import type { BabyEvent, EventType } from '../db/models';
import { finishEvent, stopEvent, type CommandOptions } from '../db/eventCommands';
import { runningEvents } from '../db/queries';
import { planStop } from '../events/stopPlan';
import { PresetNotRunnableError, runPreset, type UndoToken } from '../presets/actions';
import { presetsForBaby } from '../presets/resolve';
import type { Preset } from '../presets/types';
import { isSleepKind } from './eventFacts';
import type { NowState } from './nowState';

/*
 * Sleep is one toggle on Now (docs/design/SYNTHESIS.md 1, 01-ux-strategy.md flow 2): the state card
 * offers the action that changes the state, with at most one secondary action.
 */

export type SleepActionKind =
  /** Starts a sleep timer (kind inferred) and logs the `fell_asleep` marker. */
  | 'fell_asleep'
  /** Logs the `bed_time` marker ("in bed, routine started"); makes the next sleep a night. */
  | 'bedtime'
  /** Stops the running sleep (and any night waking) and logs the `woke_up` marker. */
  | 'woke_up'
  /** Starts a `night_waking` timer; the night sleep keeps running. */
  | 'night_waking'
  /** Same command as `woke_up`, offered during a night ("Up for the day"). */
  | 'up_for_the_day'
  /** Stops the running night waking; the night sleep continues. */
  | 'back_asleep';

export interface SleepAction {
  kind: SleepActionKind;
  /** The big button of the card; the others are secondary. */
  primary: boolean;
}

/** Night hours: a night sleep running then defaults to a night waking (before 05:00, from 19:00). */
export function isNightHours(now: Date): boolean {
  const hour = now.getHours();
  return hour >= 19 || hour < 5;
}

const primary = (kind: SleepActionKind): SleepAction => ({ kind, primary: true });
const secondary = (kind: SleepActionKind): SleepAction => ({ kind, primary: false });

/**
 * The actions the state card shows, primary first:
 * - unknown: Fell asleep, or Woke up (the first event sets the state);
 * - awake: Fell asleep, plus Bedtime;
 * - asleep, nap: Woke up;
 * - asleep, night: Night waking and Up for the day (Up for the day leads from 05:00 to 19:00);
 * - during a night waking: Back asleep, plus Up for the day.
 */
export function sleepToggleActions(state: NowState, now: Date): SleepAction[] {
  switch (state.kind) {
    case 'unknown':
      return [primary('fell_asleep'), secondary('woke_up')];
    case 'awake':
      return [primary('fell_asleep'), secondary('bedtime')];
    case 'asleep':
      if (state.nightWaking) return [primary('back_asleep'), secondary('up_for_the_day')];
      if (state.sleepKind === 'nap') return [primary('woke_up')];
      return isNightHours(now)
        ? [primary('night_waking'), secondary('up_for_the_day')]
        : [primary('up_for_the_day'), secondary('night_waking')];
  }
}

export interface SleepActionContext {
  babyId: string;
  /** The baby's event types (the built-in sleep type must be among them). */
  types: readonly EventType[];
  /** `options.now` is the tap moment (default: the current time). */
  options?: CommandOptions;
}

const PRESET_OF: Partial<Record<SleepActionKind, string>> = {
  fell_asleep: 'fell_asleep',
  bedtime: 'bedtime',
  night_waking: 'night_waking',
  woke_up: 'wake_up',
  up_for_the_day: 'wake_up',
};

function sleepPreset(types: readonly EventType[], id: string): Preset & { typeId: string } {
  const preset = presetsForBaby([...types]).find((p) => p.id === id);
  if (!preset || preset.typeId === null) throw new PresetNotRunnableError(id);
  return preset as Preset & { typeId: string };
}

/** Stops every running night waking of the sleep type at `iso` (fields complete or stripped). */
async function stopNightWakings(
  db: BabyRoutineDb,
  babyId: string,
  sleepType: EventType | undefined,
  sleepTypeId: string,
  iso: string,
  options: CommandOptions,
): Promise<Pick<UndoToken, 'stopped' | 'needsFinish'>> {
  const result: Pick<UndoToken, 'stopped' | 'needsFinish'> = { stopped: [] };
  const wakings = (await runningEvents(db, babyId)).filter(
    (e: BabyEvent) => e.typeId === sleepTypeId && isSleepKind(e, 'night_waking'),
  );
  for (const waking of wakings) {
    const plan = planStop(sleepType, waking.payload);
    if (plan.kind === 'finish') {
      (result.needsFinish ??= []).push(waking.id);
      continue;
    }
    const end = iso < waking.startedAt ? waking.startedAt : iso;
    const stopped =
      plan.kind === 'strip'
        ? await finishEvent(db, waking.id, plan.payload, end, options)
        : await stopEvent(db, waking.id, end, options);
    result.stopped.push({ id: waking.id, endedAt: stopped.endedAt ?? end });
  }
  return result;
}

function mergeTokens(a: UndoToken, b: Pick<UndoToken, 'stopped' | 'needsFinish'>): UndoToken {
  const needsFinish = [...(a.needsFinish ?? []), ...(b.needsFinish ?? [])];
  return {
    ...a,
    stopped: [...a.stopped, ...b.stopped],
    ...(needsFinish.length > 0 ? { needsFinish } : {}),
  };
}

/**
 * Runs one sleep action as a single local transaction (events + outbox) at the tap moment and
 * returns the token `undoPreset` reverts (`at` = the tap moment, for the time-shift chips).
 * Throws `PresetNotRunnableError` without the sleep type, and `PresetAlreadyRunningError` for a
 * night waking while one runs.
 */
export async function runSleepAction(
  db: BabyRoutineDb,
  action: SleepActionKind,
  ctx: SleepActionContext,
): Promise<UndoToken> {
  const when = ctx.options?.now?.() ?? new Date();
  const iso = when.toISOString();
  const options: CommandOptions = { ...ctx.options, now: () => when };
  const base = { babyId: ctx.babyId, options };

  const token = await db.transaction('rw', db.events, db.outbox, db.eventTypes, async () => {
    if (action === 'back_asleep') {
      const preset = sleepPreset(ctx.types, 'night_waking');
      const sleepType = ctx.types.find((t) => t.id === preset.typeId);
      const stops = await stopNightWakings(db, ctx.babyId, sleepType, preset.typeId, iso, options);
      return mergeTokens({ babyId: ctx.babyId, createdIds: [], stopped: [] }, stops);
    }
    const preset = sleepPreset(ctx.types, PRESET_OF[action] as string);
    const ran = await runPreset(db, preset, base);
    if (action !== 'woke_up' && action !== 'up_for_the_day') return ran;
    const sleepType = ctx.types.find((t) => t.id === preset.typeId);
    return mergeTokens(
      ran,
      await stopNightWakings(db, ctx.babyId, sleepType, preset.typeId, iso, options),
    );
  });
  return { ...token, at: iso, shiftMinutes: 0 };
}

/** Whether the action stops the running sleep or night waking (changes an event, not a new one). */
export function changesRunningSleep(kind: SleepActionKind): boolean {
  return kind === 'woke_up' || kind === 'up_for_the_day' || kind === 'back_asleep';
}

/**
 * Who logged a running sleep or night waking the user may not change (a Caregiver and someone
 * else's timer): the Woke up / Up for the day / Back asleep actions are off then. `lockedBy` is
 * `EventAccess.lockedBy`; `null` when nothing running is locked.
 */
export function runningSleepLock(
  running: readonly BabyEvent[],
  sleepTypeId: string | undefined,
  lockedBy: (event: BabyEvent) => string | null,
): string | null {
  for (const event of running) {
    if (event.typeId !== sleepTypeId) continue;
    const lock = lockedBy(event);
    if (lock !== null) return lock;
  }
  return null;
}

/** The command changed nothing (e.g. Back asleep with no night waking running). */
export function isEmptyToken(token: UndoToken): boolean {
  return (
    token.createdIds.length === 0 &&
    token.stopped.length === 0 &&
    (token.edited?.length ?? 0) === 0 &&
    (token.needsFinish?.length ?? 0) === 0
  );
}
