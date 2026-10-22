/*
 * Notification title and body from the bundled `push` catalogs (no i18next in the worker).
 * Lock-screen text is generic (no baby or medicine name) unless the payload carries `names`,
 * which the server only adds when the recipient turned on "Show names". Never a dose amount.
 */
import en from '../../i18n/locales/push.en.json';
import ptBR from '../../i18n/locales/push.pt-BR.json';
import { getOwn } from '../../util/ownProperty';
import type { AppointmentPayload, ParsedPayload, PushLang } from './payload';

export type PushCatalog = typeof en;

const CATALOGS: Record<PushLang, PushCatalog> = { en, 'pt-BR': ptBR };

export interface NotificationText {
  title: string;
  body: string;
}

const PLACEHOLDER = /\{\{\s*(\w+)\s*\}\}/g;

/**
 * Replaces `{{name}}` placeholders with own values of `values`; undefined when one is missing, so
 * a half-rendered template is never shown.
 */
export function interpolate(
  template: string,
  values: Readonly<Record<string, string>>,
): string | undefined {
  let missing = false;
  const text = template.replace(PLACEHOLDER, (_, key: string) => {
    const value = getOwn(values, key);
    if (value === undefined) missing = true;
    return value ?? '';
  });
  return missing ? undefined : text;
}

/** Local time of day (hours and minutes) in the device zone, or in `timeZone` (tests). */
export function formatTime(at: number, lang: PushLang, timeZone?: string): string {
  return new Intl.DateTimeFormat(lang, { hour: '2-digit', minute: '2-digit', timeZone }).format(
    new Date(at),
  );
}

export function catalogFor(lang: PushLang): PushCatalog {
  return CATALOGS[lang] ?? en;
}

/** The generic text ("Open the app for details") for a payload that cannot be shown. */
export function genericText(lang: PushLang): NotificationText {
  const catalog = catalogFor(lang);
  return { title: catalog.generic.title, body: catalog.generic.body };
}

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

/** How an appointment reminder is worded (keys of the `appointment_reminder` catalog entry). */
export type AppointmentPhrase = 'week' | 'tomorrow' | 'today' | 'hours' | 'minutes' | 'on';

/** `yyyy-mm-dd` of an instant in the device zone, or in `timeZone`. */
function localDateKey(at: number, timeZone?: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone,
  }).format(new Date(at));
}

/** Calendar days from the local date of `from` to the local date of `to` (DST safe). */
function calendarDaysBetween(from: number, to: number, timeZone?: string): number {
  const utcMidnight = (key: string) => Date.parse(`${key}T00:00:00Z`);
  return Math.round(
    (utcMidnight(localDateKey(to, timeZone)) - utcMidnight(localDateKey(from, timeZone))) / DAY_MS,
  );
}

/**
 * The wording of an appointment reminder shown at `now`: the offset's own phrase ("in a week",
 * "in 2 hours", "in 30 minutes") while it is still true, else the calendar relation in the
 * recipient's zone ("today", "tomorrow", "on 29 October"), e.g. when quiet hours delayed it.
 */
export function appointmentPhrase(
  at: number,
  offsetMinutes: number,
  now: number,
  timeZone?: string,
): AppointmentPhrase {
  const remaining = at - now;
  if (offsetMinutes === 10080 && remaining >= 6 * DAY_MS) return 'week';
  if (offsetMinutes === 120 && remaining >= 105 * MINUTE_MS) return 'hours';
  if (offsetMinutes === 30 && remaining >= 20 * MINUTE_MS) return 'minutes';
  const days = calendarDaysBetween(now, at, timeZone);
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  return 'on';
}

/** "Tuesday, October 29" / "terça-feira, 29 de outubro" in the device zone (or `timeZone`). */
function formatLongDate(at: number, lang: PushLang, timeZone?: string): string {
  return new Intl.DateTimeFormat(lang, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone,
  }).format(new Date(at));
}

function appointmentText(
  payload: AppointmentPayload,
  catalog: PushCatalog,
  now: number,
  timeZone?: string,
): NotificationText | undefined {
  const strings = catalog.appointment_reminder;
  const phrase = appointmentPhrase(payload.at, payload.offset, now, timeZone);
  const values: Record<string, string> = {
    time: formatTime(payload.at, payload.lang, timeZone),
    date: formatLongDate(payload.at, payload.lang, timeZone),
  };
  if (payload.names) values.baby = payload.names.baby;
  const template = payload.names ? strings[`${phrase}Named`] : strings[phrase];
  const body = interpolate(template, values);
  return body === undefined ? undefined : { title: strings.title, body };
}

/**
 * Title and body for a parsed payload; falls back to the generic text, never throws. `now` words
 * appointment reminders ("tomorrow", "in 2 hours").
 */
export function renderText(
  parsed: ParsedPayload,
  timeZone?: string,
  now: number = Date.now(),
): NotificationText {
  if (!parsed.ok) return genericText(parsed.lang);
  const { payload } = parsed;
  const catalog = catalogFor(payload.lang);
  try {
    if (payload.kind === 'test') return { title: catalog.test.title, body: catalog.test.body };
    if (payload.kind === 'appointment_reminder') {
      return appointmentText(payload, catalog, now, timeZone) ?? genericText(payload.lang);
    }

    const time = formatTime(payload.at, payload.lang, timeZone);
    const strings = catalog[payload.kind];
    const values: Record<string, string> = { time };
    const names = payload.names;
    const named =
      names !== undefined && (payload.kind !== 'dose_due' || names.medication !== undefined);
    if (named) {
      values.baby = names.baby;
      if (names.medication !== undefined) values.medication = names.medication;
    }
    const body = interpolate(named ? strings.bodyNamed : strings.body, values);
    return body === undefined ? genericText(payload.lang) : { title: strings.title, body };
  } catch {
    return genericText(payload.lang);
  }
}

/** Action button titles in the payload's language. */
export function actionTitles(lang: PushLang): PushCatalog['action'] {
  return catalogFor(lang).action;
}
