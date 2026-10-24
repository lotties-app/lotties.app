import { useMemo } from 'react';
import type { BabyEvent } from '../db/models';
import { bottlePace, expectedBottleMinutes, usualDrunkMl } from '../events/bottlePatterns';
import { useBottleHistory } from '../events/useBottleHistory';
import { usePredictions } from '../predictions/usePredictions';
import { getOwn } from '../util/ownProperty';
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

/**
 * The quiet target of a running bottle: about how long it takes at her own pace (ml per minute of
 * drinking, pauses excluded, from her recent timed bottles), with the same flag and progress as a
 * sleep. Renders nothing without enough bottles, for anything but a running bottle, or when the
 * figure is out of bounds. Never a goal: reaching it changes the wording, nothing else.
 */
export function BottleTimerTarget({
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
  const history = useBottleHistory(babyId);
  const minutes = useMemo(() => {
    if (!history || event.endedAt !== null || getOwn(event.payload, 'method') !== 'bottle') {
      return null;
    }
    const others = history.events.filter((e) => e.typeId === event.typeId && e.id !== event.id);
    const pace = bottlePace(others, history.now, event.typeId);
    const usual = usualDrunkMl(others, event.startedAt, history.now, event.typeId);
    return expectedBottleMinutes(event, pace, usual);
  }, [history, event]);
  if (minutes === null) return null;
  return (
    <TargetBar
      target={{ minutes, kind: 'bottle' }}
      effectiveSeconds={effectiveElapsedSeconds(event, nowMs)}
      compact={compact}
    />
  );
}
