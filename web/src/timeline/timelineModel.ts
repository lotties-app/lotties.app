import type { BabyEvent, EventType } from '../db/models';
import { formatDate, formatDuration, formatTime } from '../i18n/format';
import { t } from '../i18n/i18n';

/** Days loaded per page ("load older" adds another page). */
export const DAYS_PER_PAGE = 14;

export interface TimelineDay {
  /** Local calendar day `yyyy-mm-dd`. */
  key: string;
  label: string;
  events: BabyEvent[];
}

const pad = (n: number) => String(n).padStart(2, '0');

function dayKeyOf(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Local calendar day of a UTC ISO timestamp, as `yyyy-mm-dd`. */
export function localDayKey(iso: string): string {
  return dayKeyOf(new Date(iso));
}

/** UTC ISO of local midnight `days - 1` days before `now`, i.e. the start of a `days`-day window. */
export function windowStart(days: number, now: Date): string {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1));
  return start.toISOString();
}

/** `Today`, `Yesterday`, or a short weekday + date. */
export function dayLabel(key: string, now: Date): string {
  const [y, m, d] = key.split('-').map(Number);
  const day = new Date(y, m - 1, d);
  if (key === dayKeyOf(now)) return t('timeline.today');
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (key === dayKeyOf(yesterday)) return t('timeline.yesterday');
  return formatDate(day, 'weekdayDayMonth');
}

/** Groups events (already newest first) by local start day, keeping order. */
export function groupByDay(events: BabyEvent[], now: Date): TimelineDay[] {
  const days: TimelineDay[] = [];
  for (const event of events) {
    const key = localDayKey(event.startedAt);
    const last = days.at(-1);
    if (last?.key === key) last.events.push(event);
    else days.push({ key, label: dayLabel(key, now), events: [event] });
  }
  return days;
}

/** Instant events (no duration type, or ending when they start) show a single time. */
function isInstant(event: BabyEvent, type: EventType | undefined): boolean {
  return type?.hasDuration === false || event.endedAt === event.startedAt;
}

/** `08:00`, `08:00 – 08:45 · 45 min`, or `Since 08:00` for running events. */
export function describeTimes(event: BabyEvent, type: EventType | undefined): string {
  const start = formatTime(event.startedAt);
  if (event.endedAt === null) return t('timeline.since', { time: start });
  if (isInstant(event, type)) return start;
  const duration = formatDuration(Date.parse(event.endedAt) - Date.parse(event.startedAt));
  return t('timeline.range', { start, end: formatTime(event.endedAt), duration });
}

/** Events whose type is in `typeIds`; an empty selection means all types. */
export function filterByTypes(events: BabyEvent[], typeIds: ReadonlySet<string>): BabyEvent[] {
  return typeIds.size === 0 ? events : events.filter((e) => typeIds.has(e.typeId));
}
