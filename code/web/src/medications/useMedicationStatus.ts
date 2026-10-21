import { useMemo } from 'react';
import { useEventTypes, useEventsStartedSince, useBodyWeight, usePrescriptions } from '../db/hooks';
import type { Prescription } from '../db/models';
import { useNow } from '../events/time';
import { utcOffsetMinutes } from '../predictions/usePredictions';
import {
  calculateMedicationStatus,
  dosesFromEvents,
  HISTORY_LOOK_BACK_MS,
  type MedicationStatus,
} from './statusCalculator';

const HOUR_MS = 3_600_000;
const TICK_MS = 15_000;

export interface MedicationStatuses {
  now: Date;
  /** Active, non-deleted prescriptions with their computed state, oldest course first. */
  statuses: MedicationStatus[];
  /** Active and stopped prescriptions (not deleted). */
  prescriptions: Prescription[];
}

/**
 * The state of the baby's active prescriptions from the local store only (prescriptions, medication
 * events of the last 9 days, the latest weight): works offline and follows every local change.
 * `undefined` while loading. `tick` moves the clock (default 15 s).
 */
export function useMedicationStatuses(
  babyId: string,
  tickMs = TICK_MS,
): MedicationStatuses | undefined {
  const tick = useNow(tickMs);
  const since = new Date(
    Math.floor((tick - HISTORY_LOOK_BACK_MS) / HOUR_MS) * HOUR_MS,
  ).toISOString();
  const types = useEventTypes(babyId);
  const prescriptions = usePrescriptions(babyId);
  const events = useEventsStartedSince(babyId, since);
  const weight = useBodyWeight(babyId);

  return useMemo(() => {
    if (!types || !prescriptions || !events || weight === undefined) return undefined;
    const medicationTypes = new Set(types.filter((t) => t.key === 'medication').map((t) => t.id));
    const now = new Date(tick);
    return {
      now,
      prescriptions,
      statuses: calculateMedicationStatus({
        prescriptions,
        doses: dosesFromEvents(events, medicationTypes),
        now,
        utcOffsetMinutes: utcOffsetMinutes(now),
        weight: weight ? { kg: weight.kg, date: weight.date } : null,
      }),
    };
  }, [types, prescriptions, events, weight, tick]);
}
