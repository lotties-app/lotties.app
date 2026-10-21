import type { BabyEvent } from '../db/models';
import { usePredictions } from '../predictions/usePredictions';
import { effectiveElapsedSeconds } from './pauseMath';
import { TargetBar } from './TimerParts';
import { runningSleepTarget } from './targetDuration';

/**
 * The quiet target and progress of a running sleep timer, from the baby's predictions (the same
 * cached query the Now screen uses). Renders nothing without a usable figure, for other timers and
 * for a stopped one. Mount it only for sleep timers: it is what asks for the predictions.
 */
export function TimerTarget({
  babyId,
  event,
  nowMs,
  compact = false,
}: {
  babyId: string;
  event: BabyEvent;
  nowMs: number;
  compact?: boolean;
}) {
  const predictions = usePredictions(babyId).query.data;
  const target = runningSleepTarget(event, predictions);
  if (!target) return null;
  return (
    <TargetBar
      target={target}
      effectiveSeconds={effectiveElapsedSeconds(event, nowMs)}
      compact={compact}
    />
  );
}
