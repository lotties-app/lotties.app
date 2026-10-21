/*
 * Closing notifications whose item is resolved (docs/design/09-push-notifications.md section 11,
 * "Clean-up"): when a dose is logged or a nap started, on this device or synced from another one,
 * the matching notification this browser still shows is closed. Web Push cannot close it on other
 * devices; each device does it when its own data catches up. Pure decision, local data only.
 */
import type { BabyRoutineDb } from '../db/database';
import type { BabyEvent } from '../db/models';
import { eventsStartedSince } from '../db/queries';
import { dosesFromEvents, SLOT_MATCH_MS } from '../medications/statusCalculator';
import { validatePayload } from '../pwa/sw/payload';
import type { PushDevice } from './pushDevice';

/** A nap reminder is sent at most 20 min (lead) + 15 min (stale cutoff) before the window opens. */
export const NAP_RESOLVE_LOOK_BACK_MS = 60 * 60_000;
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
}

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
  const perBaby = await Promise.all(
    babies.map(async (baby) => ({
      babyId: baby.id,
      events: await eventsStartedSince(db, baby.id, since),
    })),
  );
  const live = (events: BabyEvent[]) => events.filter((event) => !event.deletedAt);
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
  };
}
