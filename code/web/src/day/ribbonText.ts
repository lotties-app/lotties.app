import type { TFunction } from 'i18next';
import type { BabyEvent, EventType, Medication, Prescription } from '../db/models';
import type { EventTypeText } from '../i18n/eventTypeText';
import { formatDuration, formatTime } from '../i18n/format';
import { typeCategory, typeIcon } from '../now/typeVisual';
import { presentEvent, type EventPresentation } from '../timeline/eventPresentation';
import { effectiveDurationMs } from '../timers/pauseMath';

/*
 * The words of the Day ribbon: when an event happened (time, or range and length), its full
 * accessible name and the name of a counted mark. The
 * title and detail come from `presentEvent`, the same text as the Day rows.
 */

/**
 * `presentEvent` that never throws: a malformed record (its row shows the error) still gets a
 * plain mark on the ribbon instead of taking the whole ribbon down.
 */
export function presentSafely(
  event: BabyEvent,
  type: EventType | undefined,
  medications: Medication[],
  names: EventTypeText,
  prescriptions: readonly Prescription[] = [],
): EventPresentation {
  try {
    return presentEvent(event, type, medications, names, prescriptions);
  } catch {
    let title = type?.name ?? '';
    try {
      if (type) title = names.typeName(type);
    } catch {
      /* keep the stored name */
    }
    return { title, icon: typeIcon(type), category: typeCategory(type), detail: '' };
  }
}

/** Instant events (no duration type, or ending when they start) have no length to show. */
export const isInstantEvent = (event: BabyEvent, type: EventType | undefined) =>
  type?.hasDuration === false || event.endedAt === event.startedAt;

export interface EventWhen {
  /** `14:05`, `09:50 – 10:08` or `Since 13:40`. */
  time: string;
  /** Effective length (`18m`), for finished events with a duration. */
  duration: string | null;
}

export function eventWhen(
  event: BabyEvent,
  type: EventType | undefined,
  t: TFunction,
  now: Date,
): EventWhen {
  const start = formatTime(event.startedAt);
  if (event.endedAt === null) {
    return {
      time: t('timeline.since', { time: start }),
      duration: formatDuration(effectiveDurationMs(event, now)),
    };
  }
  if (isInstantEvent(event, type)) return { time: start, duration: null };
  return {
    time: t('day.ribbon.range', { from: start, to: formatTime(event.endedAt) }),
    duration: formatDuration(effectiveDurationMs(event, now)),
  };
}

/** `09:50 – 10:08, 18m`: the time and, when there is one, the length. */
export const whenText = (when: EventWhen) =>
  when.duration ? `${when.time}, ${when.duration}` : when.time;

/** The detail of an event: its own title when it says more than the type name, then the rest. */
export function eventDetails(view: EventPresentation, typeName: string): string {
  return [view.title !== typeName ? view.title : '', view.detail]
    .filter((part) => part !== '')
    .join(' · ');
}

/** `Feeding 14:05, Bottle · 120 ml · Formula`. */
export function eventName(
  view: EventPresentation,
  type: EventType | undefined,
  names: EventTypeText,
  when: EventWhen,
  t: TFunction,
): string {
  const name = type ? names.typeName(type) : view.title;
  const details = eventDetails(view, name);
  const time = whenText(when);
  return details
    ? t('day.ribbon.itemName', { name, time, details })
    : t('day.ribbon.itemNameShort', { name, time });
}

/** `3 events, 14:05 to 14:40`. */
export function clusterName(events: readonly BabyEvent[], t: TFunction): string {
  const times = events.map((event) => event.startedAt).sort();
  return t('day.ribbon.cluster', {
    count: events.length,
    from: formatTime(times[0]),
    to: formatTime(times[times.length - 1]),
  });
}
