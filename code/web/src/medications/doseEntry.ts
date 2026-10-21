import type { MedicationEventPayload } from '../db/models';
import type { MedicationStatus } from './statusCalculator';

type Entry = MedicationEventPayload['medications'][number];

/** The amount offered for a prescription: the per-kg suggestion if there is one, else the fixed dose. */
export function offeredAmount(status: MedicationStatus): number | null {
  const p = status.prescription;
  if (p.dose.perKg) return status.suggestedDose?.amount ?? null;
  return p.dose.amount;
}

/** A per-kg dose always goes through the confirm step (the parent sees the inputs and confirms). */
export function needsConfirmation(status: MedicationStatus, early: boolean): boolean {
  return early || status.prescription.dose.perKg;
}

/**
 * The payload entry of a dose given under a prescription: the dose, `prescriptionId`, the weight a
 * per-kg dose was computed from (`kgUsed`) and `override: true` when it was logged before the
 * allowed time and the parent chose to log anyway.
 */
export function prescriptionEntry(
  status: MedicationStatus,
  medicationName: string,
  amount: number,
  early: boolean,
): Entry {
  const p = status.prescription;
  const kg = p.dose.perKg ? status.suggestedDose?.kgUsed : undefined;
  return {
    medicationId: p.medicationId,
    name: medicationName,
    dose: { amount, unit: p.dose.unit },
    prescriptionId: p.id,
    ...(kg !== undefined ? { kgUsed: kg } : {}),
    ...(early ? { override: true as const } : {}),
  };
}
