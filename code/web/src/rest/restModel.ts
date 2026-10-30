import {
  MAX_MINUTES,
  MAX_WORK_WINDOWS,
  MIN_MINUTES,
  type RestSettings,
  type WorkWindow,
} from './restApi';

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** The browser's IANA time zone, used on the first save. */
export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export function isTimeZone(value: string): boolean {
  if (!value.trim()) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: value.trim() });
    return true;
  } catch {
    return false;
  }
}

export type RestSettingsError =
  | 'timeZone'
  | 'tooManyWindows'
  | 'windowDays'
  | 'windowTimes'
  | 'windowSame'
  | 'nightTimes'
  | 'nightSame'
  | 'fallAsleep'
  | 'wakeLead';

const inRange = (value: number) =>
  Number.isInteger(value) && value >= MIN_MINUTES && value <= MAX_MINUTES;

/** The same checks the server makes (section 11), so a bad form never leaves the device. */
export function validateRestSettings(settings: RestSettings): RestSettingsError[] {
  const errors: RestSettingsError[] = [];
  if (!isTimeZone(settings.timeZone)) errors.push('timeZone');
  if (settings.workWindows.length > MAX_WORK_WINDOWS) errors.push('tooManyWindows');
  if (settings.workWindows.some((w) => w.days.length < 1 || w.days.length > 7)) {
    errors.push('windowDays');
  }
  if (settings.workWindows.some((w) => !TIME.test(w.start) || !TIME.test(w.end))) {
    errors.push('windowTimes');
  } else if (settings.workWindows.some((w) => w.start === w.end)) errors.push('windowSame');
  if (!TIME.test(settings.nightStart) || !TIME.test(settings.nightEnd)) errors.push('nightTimes');
  else if (settings.nightStart === settings.nightEnd) errors.push('nightSame');
  if (!inRange(settings.fallAsleepMinutes)) errors.push('fallAsleep');
  if (!inRange(settings.wakeLeadMinutes)) errors.push('wakeLead');
  return errors;
}

/** The body of the PUT: exactly the contract's fields, days sorted and distinct. */
export function toPayload(settings: RestSettings): RestSettings {
  return {
    enabled: settings.enabled,
    timeZone: settings.timeZone.trim(),
    workWindows: settings.workWindows.map((w): WorkWindow => ({
      days: [...new Set(w.days)].sort((a, b) => a - b),
      start: w.start,
      end: w.end,
    })),
    nightStart: settings.nightStart,
    nightEnd: settings.nightEnd,
    fallAsleepMinutes: settings.fallAsleepMinutes,
    wakeLeadMinutes: settings.wakeLeadMinutes,
  };
}

/** `yyyy-mm-dd` plus `delta` days (calendar arithmetic, no zone). */
export function shiftNight(night: string, delta: number): string {
  const [y, m, d] = night.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10);
}

/**
 * "Up since 06:40" typed as a time of day: the latest such moment that is not in the future
 * (a time later than now today means yesterday's).
 */
export function upAtFromTime(time: string, now: Date): string | null {
  if (!TIME.test(time)) return null;
  const [h, m] = time.split(':').map(Number);
  const at = new Date(now);
  at.setHours(h, m, 0, 0);
  if (at.getTime() > now.getTime()) at.setDate(at.getDate() - 1);
  return at.toISOString();
}
