/*
 * Closing notifications whose item is resolved (docs/design/09-push-notifications.md section 11,
 * "Clean-up"): when a dose is logged, a nap started (also for the overtired heads-up), or a belly
 * pain or belly massage, or a fussy spell, logged for the usual window
 * (docs/design/11-patterns.md), or a wet or dirty diaper for a diaper heads-up, on this device or
 * synced from another one,
 * the matching notification this browser still shows is closed. Web Push cannot close it on other
 * devices; each device does it when its own data catches up. Pure decision, local data only.
 */
import type { BabyRoutineDb } from '../db/database';
import type { BabyEvent } from '../db/models';
import { isDirtyDiaper, isWetDiaper } from '../now/diaperPredictions';
import { eventsStartedSince } from '../db/queries';
import { dosesFromEvents, SLOT_MATCH_MS } from '../medications/statusCalculator';
import { validatePayload } from '../pwa/sw/payload';
import type { PushDevice } from './pushDevice';

/** A nap reminder is sent at most 20 min (lead) + 15 min (stale cutoff) before the window opens. */
export const NAP_RESOLVE_LOOK_BACK_MS = 60 * 60_000;
/** A belly pain or massage from this long before the usual window handles it (the card's lead). */
export const BELLY_RESOLVE_LOOK_BACK_MS = 45 * 60_000;
/** A fussy spell from this long before the usual window handles it (the card's lead). */
export const FUSSY_RESOLVE_LOOK_BACK_MS = 45 * 60_000;
/**
 * The overtired heads-up is sent from 15 min before the limit (`at`) and at most 15 min late: a
 * sleep started from 30 min before the limit ends that awake stretch.
 */
export const OVERTIRED_RESOLVE_LOOK_BACK_MS = 30 * 60_000;
/**
 * The wet heads-up is sent 10 min before the expected time (`at`): a wet diaper logged from then
 * on resolves it (one logged earlier would have moved the expected time, so no heads-up is sent).
 */
export const WET_RESOLVE_LOOK_BACK_MS = 10 * 60_000;
/**
 * The dirty heads-up is sent at most 40 min before `at` (the lower lag after a feed; 5 min from
 * the gaps): a dirty diaper logged from an hour before `at` resolves it.
 */
export const DIRTY_RESOLVE_LOOK_BACK_MS = 60 * 60_000;
/** How far back local events are read: a dose slot matches doses up to 90 min around it. */
export const RESOLVE_HISTORY_MS = 26 * 60 * 60_000;

export interface ResolutionFacts {
  doses: readonly {
    babyId: string;
    givenAt: number;
    medicationId: string | null;
    prescriptionId: string | null;
  }[];
  /** Prescription id -> medication id (doses that name only the medication still count). */
  prescriptions: ReadonlyMap<string, string>;
  sleepStarts: readonly { babyId: string; startedAt: number }[];
  /** Starts of belly pain and belly massage events. */
  bellyStarts: readonly { babyId: string; startedAt: number }[];
  /** Starts of fussy spells (absent = none). */
  fussyStarts?: readonly { babyId: string; startedAt: number }[];
  /** Starts of wet diapers (`WET` or `MIXED`; absent = none). */
  wetStarts?: readonly { babyId: string; startedAt: number }[];
  /** Starts of dirty diapers (`DIRTY` or `MIXED`; absent = none). */
  dirtyStarts?: readonly { babyId: string; startedAt: number }[];
}

const loggedSince = (
  starts: readonly { babyId: string; startedAt: number }[] | undefined,
  babyId: string,
  from: number,
) => (starts ?? []).some((start) => start.babyId === babyId && start.startedAt >= from);

/** True when the item a shown notification is about is resolved in the local data. */
export function isResolved(data: unknown, facts: ResolutionFacts): boolean {
  const parsed = validatePayload(data);
  if (!parsed.ok) return false;
  const { payload } = parsed;
  switch (payload.kind) {
    case 'dose_due': {
      const medicationId = facts.prescriptions.get(payload.rxId);
      return facts.doses.some(
        (dose) =>
          dose.babyId === payload.babyId &&
          Math.abs(dose.givenAt - payload.at) <= SLOT_MATCH_MS &&
          (dose.prescriptionId === payload.rxId ||
            (dose.prescriptionId === null &&
              medicationId !== undefined &&
              dose.medicationId === medicationId)),
      );
    }
    case 'nap_window':
      return facts.sleepStarts.some(
        (sleep) =>
          sleep.babyId === payload.babyId &&
          sleep.startedAt >= payload.at - NAP_RESOLVE_LOOK_BACK_MS,
      );
    case 'belly_pain_pattern':
      return facts.bellyStarts.some(
        (belly) =>
          belly.babyId === payload.babyId &&
          belly.startedAt >= payload.at - BELLY_RESOLVE_LOOK_BACK_MS,
      );
    case 'overtired_warning':
      return facts.sleepStarts.some(
        (sleep) =>
          sleep.babyId === payload.babyId &&
          sleep.startedAt >= payload.at - OVERTIRED_RESOLVE_LOOK_BACK_MS,
      );
    case 'fussy_pattern':
      return (facts.fussyStarts ?? []).some(
        (fussy) =>
          fussy.babyId === payload.babyId &&
          fussy.startedAt >= payload.at - FUSSY_RESOLVE_LOOK_BACK_MS,
      );
    case 'diaper_wet_headsup':
      return loggedSince(facts.wetStarts, payload.babyId, payload.at - WET_RESOLVE_LOOK_BACK_MS);
    case 'diaper_dirty_headsup':
      return loggedSince(
        facts.dirtyStarts,
        payload.babyId,
        payload.at - DIRTY_RESOLVE_LOOK_BACK_MS,
      );
    // An appointment reminder stays until the person dismisses or opens it (its time is fixed), and
    // so does a doctor suggestion (the page it opens lists what is still waiting).
    case 'appointment_reminder':
    case 'doctor_suggestion':
    case 'test':
      return false;
  }
}

/** Closes the shown notifications whose item is resolved; returns how many. Never throws. */
export async function closeResolvedNotifications(
  device: Pick<PushDevice, 'shownNotifications'>,
  facts: ResolutionFacts,
): Promise<number> {
  try {
    const shown = await device.shownNotifications();
    const resolved = shown.filter((notification) => isResolved(notification.data, facts));
    for (const notification of resolved) notification.close();
    return resolved.length;
  } catch {
    return 0;
  }
}

/** Builds the facts from events of the last 26 hours of every baby (local store only). */
export async function loadResolutionFacts(
  db: BabyRoutineDb,
  now: number,
): Promise<ResolutionFacts> {
  const since = new Date(now - RESOLVE_HISTORY_MS).toISOString();
  const [babies, types, prescriptions] = await Promise.all([
    db.babies.toArray(),
    db.eventTypes.toArray(),
    db.prescriptions.toArray(),
  ]);
  const medicationTypes = new Set(types.filter((t) => t.key === 'medication').map((t) => t.id));
  const sleepTypes = new Set(types.filter((t) => t.key === 'sleep').map((t) => t.id));
  const bellyTypes = new Set(
    types.filter((t) => t.key === 'belly_pain' || t.key === 'belly_massage').map((t) => t.id),
  );
  const fussyTypes = new Set(types.filter((t) => t.key === 'fussy').map((t) => t.id));
  const diaperTypes = new Set(types.filter((t) => t.key === 'diaper').map((t) => t.id));
  const perBaby = await Promise.all(
    babies.map(async (baby) => ({
      babyId: baby.id,
      events: await eventsStartedSince(db, baby.id, since),
    })),
  );
  const live = (events: BabyEvent[]) => events.filter((event) => !event.deletedAt);
  const diaperStarts = (test: (event: BabyEvent) => boolean) =>
    perBaby.flatMap(({ babyId, events }) =>
      live(events)
        .filter((event) => diaperTypes.has(event.typeId) && test(event))
        .map((event) => ({ babyId, startedAt: Date.parse(event.startedAt) })),
    );
  return {
    doses: perBaby.flatMap(({ babyId, events }) =>
      dosesFromEvents(events, medicationTypes).map((dose) => ({ ...dose, babyId })),
    ),
    prescriptions: new Map(prescriptions.map((p) => [p.id, p.medicationId])),
    sleepStarts: perBaby.flatMap(({ babyId, events }) =>
      live(events)
        .filter((event) => sleepTypes.has(event.typeId))
        .map((event) => ({ babyId, startedAt: Date.parse(event.startedAt) })),
    ),
    bellyStarts: perBaby.flatMap(({ babyId, events }) =>
      live(events)
        .filter((event) => bellyTypes.has(event.typeId))
        .map((event) => ({ babyId, startedAt: Date.parse(event.startedAt) })),
    ),
    fussyStarts: perBaby.flatMap(({ babyId, events }) =>
      live(events)
        .filter((event) => fussyTypes.has(event.typeId))
        .map((event) => ({ babyId, startedAt: Date.parse(event.startedAt) })),
    ),
    wetStarts: diaperStarts(isWetDiaper),
    dirtyStarts: diaperStarts(isDirtyDiaper),
  };
}
