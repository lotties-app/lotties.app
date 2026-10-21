import type { BabyRoutineDb } from './database';
import type { BodyWeightRow } from './models';
import type { MeasurementDto } from '../sync/contract';

/** The latest measurement with a weight (newest date, then newest creation), if any. */
export function latestWeightOf(measurements: readonly MeasurementDto[]): BodyWeightRow | null {
  let best: MeasurementDto | null = null;
  for (const m of measurements) {
    if (m.weightKg === null || m.weightKg === undefined) continue;
    if (!best || m.date > best.date || (m.date === best.date && m.createdAt > best.createdAt)) {
      best = m;
    }
  }
  return best && best.weightKg !== null
    ? { babyId: best.babyId, kg: best.weightKg, date: best.date }
    : null;
}

/**
 * Keeps the latest weight of a baby on the device (measurements themselves are online-only), so
 * per-kg suggestions work offline. An empty list removes it.
 */
export async function saveLatestWeight(
  db: BabyRoutineDb,
  babyId: string,
  measurements: readonly MeasurementDto[],
): Promise<void> {
  const latest = latestWeightOf(measurements);
  if (latest) await db.bodyWeights.put({ ...latest, babyId });
  else await db.bodyWeights.delete(babyId);
}
