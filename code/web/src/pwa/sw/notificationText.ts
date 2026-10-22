/*
 * Notification title and body from the bundled `push` catalogs (no i18next in the worker).
 * Lock-screen text is generic (no baby or medicine name) unless the payload carries `names`,
 * which the server only adds when the recipient turned on "Show names". Never a dose amount.
 */
import en from '../../i18n/locales/push.en.json';
import ptBR from '../../i18n/locales/push.pt-BR.json';
import { getOwn } from '../../util/ownProperty';
import type { ParsedPayload, PushLang } from './payload';

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

/** Title and body for a parsed payload; falls back to the generic text, never throws. */
export function renderText(parsed: ParsedPayload, timeZone?: string): NotificationText {
  if (!parsed.ok) return genericText(parsed.lang);
  const { payload } = parsed;
  const catalog = catalogFor(payload.lang);
  try {
    if (payload.kind === 'test') return { title: catalog.test.title, body: catalog.test.body };

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
