import { useMemo } from 'react';
import { eventAccess, type EventAccess } from '../baby/useEventAccess';
import {
  useEventTypes,
  useEventsStartedSince,
  useMedications,
  useRunningEvents,
} from '../db/hooks';
import type { Baby, BabyEvent, EventType, Medication } from '../db/models';
import { useNow } from '../events/time';
import { useBottleHistory } from '../events/useBottleHistory';
import { useMedicationStatuses, type MedicationStatuses } from '../medications/useMedicationStatus';
import { usePredictions } from '../predictions/usePredictions';
import { catchUp, type CatchUp } from './catchUp';
import { DAY_MS, HOUR_MS } from './eventFacts';
import { deriveNowState, type NowState } from './nowState';
import {
  bellyPainTray,
  diaperTray,
  feedTrayOptions,
  lastAndLogTiles,
  medsTray,
  type BellyPainTray,
  type DiaperTray,
  type FeedTray,
  type MedsTray,
  type QuickTile,
} from './quickLog';
import { sleepToggleActions, type SleepAction } from './sleepToggle';
import { forgottenTimers, type ForgottenTimer } from './timers';
import { useHandover } from './useHandover';
import { useMembers } from './useMembers';
import { useNowCommands, type NowCommands } from './useNowCommands';

/** The Now screen refreshes its minutes this often. */
export const NOW_TICK_MS = 15_000;
/** Events loaded for the state, tiles and catch-up (plus every running timer, however old). */
const LOOK_BACK_MS = 3 * DAY_MS;

export interface NowTrays {
  feed: FeedTray | null;
  diaper: DiaperTray | null;
  meds: MedsTray | null;
  bellyPain: BellyPainTray | null;
}

export interface NowScreenModel {
  /** The clock of this render (moves every 15 s). */
  now: Date;
  state: NowState;
  /** The state card's actions, primary first. */
  sleepActions: SleepAction[];
  tiles: QuickTile[];
  trays: NowTrays;
  /** Every running timer, oldest first. */
  running: BabyEvent[];
  /** Forgotten state of the running timers past their threshold, by event id. */
  forgotten: Map<string, ForgottenTimer>;
  /** What others logged since this device last showed the baby (`null`: nothing to show). */
  catchUp: CatchUp | null;
  acknowledgeCatchUp: () => void;
  types: EventType[];
  medications: Medication[];
  /** Active prescriptions with their computed state (offline calculator). */
  meds: MedicationStatuses;
  /** The last 3 days plus running timers, newest first. */
  events: BabyEvent[];
  /** Viewers read; the commands are for Owners, Parents and Caregivers. */
  readOnly: boolean;
  /**
   * Per event: whether the user may change it, and who logged it (a Caregiver changes only their
   * own entries: someone else's running timer shows "Started by" instead of its controls).
   */
  access: EventAccess;
  commands: NowCommands;
}

/** Start of the loaded window, rounded down to the hour so the query changes once an hour. */
function lookBackStart(tick: number): string {
  return new Date(Math.floor((tick - LOOK_BACK_MS) / HOUR_MS) * HOUR_MS).toISOString();
}

/**
 * The clock of the derived values: the tick, or the newest local edit when that is later (a command
 * just ran between two ticks: its events must not look like the future).
 */
function clockOf(tick: number, events: readonly BabyEvent[]): Date {
  let latest = tick;
  for (const e of events) {
    const edited = Date.parse(e.clientUpdatedAt ?? e.updatedAt);
    if (edited > latest && edited - tick < NOW_TICK_MS * 2) latest = edited;
  }
  return new Date(latest);
}

function mergeRunning(recent: BabyEvent[], running: BabyEvent[]): BabyEvent[] {
  const ids = new Set(recent.map((e) => e.id));
  const older = running.filter((e) => !ids.has(e.id)).reverse();
  return [...recent, ...older];
}

/**
 * Everything the Now screen shows for one baby, from the local store (live queries), the
 * predictions query and the members list; `undefined` while the local data loads. Derived values
 * are recomputed only when their inputs or the 15 s tick change.
 */
export function useNowScreen(baby: Baby): NowScreenModel | undefined {
  const tick = useNow(NOW_TICK_MS);
  const since = lookBackStart(tick);
  const types = useEventTypes(baby.id);
  const medications = useMedications(baby.id);
  const recent = useEventsStartedSince(baby.id, since);
  const runningTimers = useRunningEvents(baby.id);
  const predictions = usePredictions(baby.id).query.data;
  const members = useMembers(baby.id);
  const handover = useHandover(baby.id);
  const meds = useMedicationStatuses(baby.id);
  const commands = useNowCommands(baby, types ?? EMPTY_TYPES);
  const bottleHistory = useBottleHistory(baby.id);
  const access = useMemo(() => eventAccess(baby, members), [baby, members]);

  const events = useMemo(
    () => (recent && runningTimers ? mergeRunning(recent, runningTimers) : undefined),
    [recent, runningTimers],
  );

  const derived = useMemo(() => {
    if (!types || !events || !medications || !meds) return undefined;
    const now = clockOf(tick, events);
    const state = deriveNowState(events, types, predictions, now);
    return {
      now,
      state,
      sleepActions: sleepToggleActions(state, now),
      tiles: lastAndLogTiles(types, events, now),
      trays: {
        feed: feedTrayOptions(baby.id, types, events, now, {
          events: bottleHistory?.events ?? events,
          birthDate: baby.birthDate,
        }),
        diaper: diaperTray(types),
        meds: medsTray(baby.id, types, medications, events, now, meds.statuses),
        bellyPain: bellyPainTray(types),
      },
      forgotten: forgottenTimers(events, types, now),
      catchUp: catchUp(events, members, handover.since, now, { types }),
    };
  }, [
    types,
    events,
    medications,
    meds,
    predictions,
    members,
    handover.since,
    tick,
    baby.id,
    baby.birthDate,
    bottleHistory,
  ]);

  return useMemo(() => {
    if (!derived || !types || !events || !medications || !meds || !runningTimers) return undefined;
    return {
      ...derived,
      running: runningTimers,
      acknowledgeCatchUp: handover.acknowledge,
      types,
      medications,
      meds,
      events,
      readOnly: !access.canLog,
      access,
      commands,
    };
  }, [
    derived,
    types,
    events,
    medications,
    meds,
    runningTimers,
    handover.acknowledge,
    access,
    commands,
  ]);
}

const EMPTY_TYPES: EventType[] = [];
