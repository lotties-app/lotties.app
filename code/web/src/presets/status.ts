import type { BabyEvent } from '../db/models';
import { formatTime } from '../i18n/format';
import { t } from '../i18n/i18n';
import type { Preset } from './types';

export type PresetStatus = 'running' | { lastAt: string } | 'untracked-today';

const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;
/** Sleep started within this long after a bedtime marker is the night. */
const BEDTIME_WINDOW_MS = 3 * HOUR_MS;

/** True when the event is one of the preset's own (same type and every default payload field). */
export function eventMatchesPreset(
  preset: Pick<Preset, 'typeId' | 'payloadDefaults'>,
  e: BabyEvent,
) {
  return (
    e.deletedAt === null &&
    e.typeId === preset.typeId &&
    Object.entries(preset.payloadDefaults).every(([key, value]) => payloadValue(e, key) === value)
  );
}

function payloadValue(event: BabyEvent, key: string): unknown {
  return Object.hasOwn(event.payload, key) ? event.payload[key] : undefined;
}

function sameLocalDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * Tile status: `running` while one of the preset's timers runs; otherwise the start of its latest
 * event when that is from today (or less than 12 h ago, e.g. last night's bedtime); otherwise
 * `untracked-today`. `events` may contain any events of the baby, in any order.
 */
export function presetStatus(
  preset: Pick<Preset, 'typeId' | 'payloadDefaults' | 'mode'>,
  events: readonly BabyEvent[],
  now: Date,
): PresetStatus {
  if (preset.typeId === null) return 'untracked-today';
  const own = events.filter((e) => eventMatchesPreset(preset, e));
  if (preset.mode === 'timer' && own.some((e) => e.endedAt === null)) return 'running';

  let lastAt: string | undefined;
  for (const e of own)
    if (e.startedAt <= now.toISOString() && (!lastAt || e.startedAt > lastAt)) lastAt = e.startedAt;
  if (!lastAt) return 'untracked-today';

  const last = new Date(lastAt);
  const recent = now.getTime() - last.getTime() < 12 * HOUR_MS;
  return sameLocalDay(last, now) || recent ? { lastAt } : 'untracked-today';
}

/** `h:mm` of elapsed time (`0:42`, `1:05`): digits only, the same in every language. */
function formatHoursMinutes(ms: number) {
  const minutes = Math.max(0, Math.floor(ms / MINUTE_MS));
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
}

/**
 * Tile status line, localized: "Running 0:42", "Last 12 min ago", "Last 2h ago", "Last 07:05"
 * (12 h or more ago) or "Not tracked today". `startedAt` is the running timer's start. The
 * structured `PresetStatus` stays language-free, so `presetStatus` remains a pure function.
 */
export function formatPresetStatus(status: PresetStatus, now: Date, startedAt?: string): string {
  if (status === 'running') {
    const time = formatHoursMinutes(startedAt ? now.getTime() - Date.parse(startedAt) : 0);
    return t('presets.status.running', { time });
  }
  if (status === 'untracked-today') return t('presets.status.untrackedToday');

  const ago = Math.max(0, now.getTime() - Date.parse(status.lastAt));
  if (ago >= 12 * HOUR_MS)
    return t('presets.status.lastClock', { time: formatTime(status.lastAt) });
  if (ago < MINUTE_MS) return t('presets.status.lastJustNow');
  if (ago < HOUR_MS) {
    return t('presets.status.lastMinutes', { count: Math.floor(ago / MINUTE_MS) });
  }
  return t('presets.status.lastHours', { count: Math.floor(ago / HOUR_MS) });
}

/** Start of the preset's running timer, if one runs (feeds the "Running 0:42" line). */
export function runningSince(
  preset: Pick<Preset, 'typeId' | 'payloadDefaults'>,
  events: readonly BabyEvent[],
): string | undefined {
  return events
    .filter((e) => e.endedAt === null && eventMatchesPreset(preset, e))
    .map((e) => e.startedAt)
    .sort()[0];
}

/**
 * Kind of the sleep timer started by "Fell asleep": `night` when a bedtime marker was logged in
 * the last 3 hours or the local time is 19:00-05:00, else `nap`.
 */
export function inferFellAsleepKind(events: readonly BabyEvent[], now: Date): 'night' | 'nap' {
  const since = now.getTime() - BEDTIME_WINDOW_MS;
  const bedtimeLogged = events.some((e) => {
    const t = Date.parse(e.startedAt);
    return (
      e.deletedAt === null &&
      payloadValue(e, 'kind') === 'bed_time' &&
      t >= since &&
      t <= now.getTime()
    );
  });
  const hour = now.getHours();
  return bedtimeLogged || hour >= 19 || hour < 5 ? 'night' : 'nap';
}
