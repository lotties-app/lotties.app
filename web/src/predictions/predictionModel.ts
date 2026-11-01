import type { EventType } from '../db/models';
import { formatClock, formatDuration } from '../events/time';
import type { PredictionDto } from '../sync/contract';
import { localDayKey } from '../timeline/timelineModel';

/** The baby's own type wins over a built-in template with the same key. */
export function typeForKey(types: EventType[], key: string, babyId: string): EventType | undefined {
  const matches = types.filter((t) => t.key === key);
  return matches.find((t) => t.babyId === babyId) ?? matches[0];
}

export function typeNameForKey(types: EventType[], key: string, babyId: string): string {
  return typeForKey(types, key, babyId)?.name ?? key.replace(/_/g, ' ');
}

function dayOffset(iso: string, now: Date): number {
  const [y, m, d] = localDayKey(iso).split('-').map(Number);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((new Date(y, m - 1, d).getTime() - today.getTime()) / 86_400_000);
}

/** `14:20`, or with a day hint when not today: `tomorrow 02:10`, `yesterday 23:50`. */
export function clockWithDay(iso: string, now: Date): string {
  const offset = dayOffset(iso, now);
  const clock = formatClock(iso);
  if (offset === 0) return clock;
  if (offset === 1) return `tomorrow ${clock}`;
  if (offset === -1) return `yesterday ${clock}`;
  return `${localDayKey(iso)} ${clock}`;
}

/** `around 14:20, between 14:05 and 14:40` (local time). */
export function describeWindow(prediction: PredictionDto, now: Date): string {
  const { earliest, expected, latest } = prediction.nextStart;
  return (
    `around ${clockWithDay(expected, now)}, ` +
    `between ${clockWithDay(earliest, now)} and ${clockWithDay(latest, now)}`
  );
}

/** The expected start has passed without a new event replacing the prediction. */
export function isOverdue(prediction: PredictionDto, now: Date): boolean {
  return Date.parse(prediction.nextStart.expected) < now.getTime();
}

export function describeDuration(prediction: PredictionDto): string | null {
  const duration = prediction.expectedDuration;
  return duration ? `usually lasts ${formatDuration(duration.minutes * 60_000)}` : null;
}
