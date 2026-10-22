/*
 * Push payload parsing (docs/design/09-push-notifications.md sections 3 and 8). The server sends
 * codes, ids and instants only: `{v, id, kind, babyId?, rxId?, apptId?, offset?, proposalId?,
 * noteId?, at, lang, token?, names?, snooze?}` (never an appointment's title, doctor or notes, a
 * medicine name or the text of a note).
 * Everything here is pure and never throws: anything unexpected becomes a generic notification
 * ("Open the app for details"), so a raw code or a broken string never reaches the lock screen.
 */
import { getOwn } from '../../util/ownProperty';

export const PAYLOAD_VERSION = 1;
export const SUPPORTED_LANGS = ['en', 'pt-BR'] as const;
export type PushLang = (typeof SUPPORTED_LANGS)[number];

/** Names are trimmed to this length by the server; longer values are cut again here. */
export const MAX_NAME_LENGTH = 40;
/** Snooze re-sends are numbered 1 to 3 (`{base}:s{n}` on the server). */
export const MAX_SNOOZES = 3;

const KINDS = {
  dose_due: true,
  nap_window: true,
  belly_pain_pattern: true,
  overtired_warning: true,
  fussy_pattern: true,
  diaper_wet_headsup: true,
  diaper_dirty_headsup: true,
  appointment_reminder: true,
  doctor_suggestion: true,
  test: true,
} as const;
export type PushKind = keyof typeof KINDS;

export interface PushNames {
  baby: string;
  medication?: string;
}

interface PayloadBase {
  /** Delivery id (lower-case GUID); also the id the snooze action posts to. */
  id: string;
  /**
   * Instant shown in the text: the dose slot, the nap window's earliest start, the start of the
   * usual belly pain or fussy window, when the awake stretch reaches the usual limit, or when the
   * wet or dirty diaper is expected (epoch ms).
   */
  at: number;
  lang: PushLang;
  names?: PushNames;
  /** 1-3 on a snooze re-send, absent otherwise. */
  snooze?: number;
}

export interface DosePayload extends PayloadBase {
  kind: 'dose_due';
  babyId: string;
  rxId: string;
  /** Per-delivery action token (base64url); without it no snooze action is offered. */
  token?: string;
}

export interface NapPayload extends PayloadBase {
  kind: 'nap_window';
  babyId: string;
  token?: string;
}

/** The belly pain pattern heads-up: codes only, never a symptom detail or medical advice. */
export interface BellyPainPayload extends PayloadBase {
  kind: 'belly_pain_pattern';
  babyId: string;
  token?: string;
}

/** The overtired heads-up: codes only, never a symptom detail or medical advice. */
export interface OvertiredPayload extends PayloadBase {
  kind: 'overtired_warning';
  babyId: string;
  token?: string;
}

/** The fussy pattern heads-up: codes only, never a symptom detail or medical advice. */
export interface FussyPayload extends PayloadBase {
  kind: 'fussy_pattern';
  babyId: string;
  token?: string;
}

/** The diaper heads-ups (wet and dirty): codes only, never a symptom detail or medical advice. */
export interface DiaperPayload extends PayloadBase {
  kind: 'diaper_wet_headsup' | 'diaper_dirty_headsup';
  babyId: string;
  token?: string;
}

/** The reminder offsets of an appointment, in minutes before its start (1 week, 1 day, 2 h, 30 min). */
export const APPOINTMENT_OFFSETS = [10080, 1440, 120, 30] as const;
export type AppointmentOffset = (typeof APPOINTMENT_OFFSETS)[number];

/**
 * An appointment reminder: the appointment id, its start (`at`) and the reminder offset; the text is
 * worded from them in the recipient's zone. Never the title, the doctor or the notes.
 */
export interface AppointmentPayload extends PayloadBase {
  kind: 'appointment_reminder';
  babyId: string;
  apptId: string;
  offset: AppointmentOffset;
  token?: string;
}

/**
 * The doctor sent a suggestion (docs/design/16-doctor-access.md section 10.4): exactly one of a
 * proposal id and a note id (a recommendation); `at` is when it was created. Generic lock-screen
 * text only: never the medicine name, the dose or the note text.
 */
export type DoctorSuggestionPayload = PayloadBase & {
  kind: 'doctor_suggestion';
  babyId: string;
} & ({ proposalId: string; noteId?: never } | { noteId: string; proposalId?: never });

export interface TestPayload extends PayloadBase {
  kind: 'test';
}

export type PushPayload =
  | DosePayload
  | NapPayload
  | BellyPainPayload
  | OvertiredPayload
  | FussyPayload
  | DiaperPayload
  | AppointmentPayload
  | DoctorSuggestionPayload
  | TestPayload;

/** The kinds about a baby that open Now and carry nothing but codes (not a dose). */
const BABY_ONLY_KINDS: ReadonlySet<string> = new Set([
  'nap_window',
  'belly_pain_pattern',
  'overtired_warning',
  'fussy_pattern',
  'diaper_wet_headsup',
  'diaper_dirty_headsup',
]);

type BabyOnlyKind = (
  NapPayload | BellyPainPayload | OvertiredPayload | FussyPayload | DiaperPayload
)['kind'];

const isBabyOnlyKind = (kind: string): kind is BabyOnlyKind => BABY_ONLY_KINDS.has(kind);

/** A valid payload, or the generic fallback (only the language survives). */
export type ParsedPayload = { ok: true; payload: PushPayload } | { ok: false; lang: PushLang };

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN = /^[A-Za-z0-9_-]{16,128}$/;
/** ISO 8601 instant with an explicit zone (`Z` or an offset), as the API serialises it. */
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,7})?)?(Z|[+-]\d{2}:\d{2})$/;
/** Control characters and line/paragraph separators (never shown on a notification). */
const CONTROL = /[\p{Cc}\p{Zl}\p{Zp}]/gu;

type Json = Record<string, unknown>;

const isRecord = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const field = (record: Json, key: string): unknown => getOwn(record, key);

/** A lower-case GUID, or undefined. */
export function guid(value: unknown): string | undefined {
  return typeof value === 'string' && GUID.test(value) ? value.toLowerCase() : undefined;
}

/** The supported language for a BCP 47 tag (`pt`, `pt-BR`, `pt-PT` -> `pt-BR`; anything else `en`). */
export function resolveLang(value: unknown): PushLang {
  if (typeof value !== 'string') return 'en';
  return value.trim().toLowerCase().startsWith('pt') ? 'pt-BR' : 'en';
}

function instant(value: unknown): number | undefined {
  if (typeof value !== 'string' || !INSTANT.test(value)) return undefined;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : undefined;
}

function name(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const clean = value.replace(CONTROL, ' ').replace(/\s+/g, ' ').trim();
  if (!clean) return undefined;
  return Array.from(clean).slice(0, MAX_NAME_LENGTH).join('').trim();
}

/** Names only when they are well formed; anything else falls back to generic lock-screen text. */
function names(value: unknown): PushNames | undefined {
  if (!isRecord(value)) return undefined;
  const baby = name(field(value, 'baby'));
  if (!baby) return undefined;
  const medication = name(field(value, 'medication'));
  return medication ? { baby, medication } : { baby };
}

function snooze(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= MAX_SNOOZES
    ? value
    : undefined;
}

function offset(value: unknown): AppointmentOffset | undefined {
  return APPOINTMENT_OFFSETS.find((candidate) => candidate === value);
}

function token(value: unknown): string | undefined {
  return typeof value === 'string' && TOKEN.test(value) ? value : undefined;
}

/** Validates an already-decoded payload object (also used to re-check notification `data`). */
export function validatePayload(raw: unknown): ParsedPayload {
  if (!isRecord(raw)) return { ok: false, lang: 'en' };
  const lang = resolveLang(field(raw, 'lang'));
  const fail: ParsedPayload = { ok: false, lang };
  const kind = field(raw, 'kind');
  if (field(raw, 'v') !== PAYLOAD_VERSION || typeof kind !== 'string') return fail;
  if (!getOwn<boolean>(KINDS, kind)) return fail;

  const id = guid(field(raw, 'id'));
  const at = instant(field(raw, 'at'));
  if (!id || at === undefined) return fail;

  const base: PayloadBase = { id, at, lang };
  const shownNames = names(field(raw, 'names'));
  if (shownNames) base.names = shownNames;
  const snoozeNumber = snooze(field(raw, 'snooze'));
  if (snoozeNumber) base.snooze = snoozeNumber;

  if (kind === 'test') return { ok: true, payload: { ...base, kind } };

  const babyId = guid(field(raw, 'babyId'));
  if (!babyId) return fail;
  const actionToken = token(field(raw, 'token'));
  const withToken = actionToken ? { token: actionToken } : {};

  if (isBabyOnlyKind(kind)) {
    return { ok: true, payload: { ...base, ...withToken, kind, babyId } };
  }

  if (kind === 'appointment_reminder') {
    const apptId = guid(field(raw, 'apptId'));
    const minutes = offset(field(raw, 'offset'));
    if (!apptId || minutes === undefined) return fail;
    return { ok: true, payload: { ...base, ...withToken, kind, babyId, apptId, offset: minutes } };
  }

  if (kind === 'doctor_suggestion') {
    // A suggestion names its proposal or its note, never both and never neither.
    const proposalId = guid(field(raw, 'proposalId'));
    const noteId = guid(field(raw, 'noteId'));
    if (!proposalId === !noteId) return fail;
    return {
      ok: true,
      payload: proposalId
        ? { ...base, kind, babyId, proposalId }
        : { ...base, kind, babyId, noteId: noteId as string },
    };
  }

  const rxId = guid(field(raw, 'rxId'));
  if (!rxId) return fail;
  return { ok: true, payload: { ...base, ...withToken, kind: 'dose_due', babyId, rxId } };
}

/**
 * The validated payload back in wire form (`v`, ISO `at`): stored as the notification's `data`
 * and re-checked with {@link validatePayload} on click. Unknown fields are not carried over.
 */
export function toWirePayload(payload: PushPayload): Json {
  const { at, ...rest } = payload;
  return { v: PAYLOAD_VERSION, ...rest, at: new Date(at).toISOString() };
}

/** Parses the push message text (UTF-8 JSON). Never throws. */
export function parsePayload(
  text: string | null | undefined,
  fallbackLang: PushLang,
): ParsedPayload {
  if (typeof text !== 'string' || text.length === 0) return { ok: false, lang: fallbackLang };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, lang: fallbackLang };
  }
  if (!isRecord(raw)) return { ok: false, lang: fallbackLang };
  const result = validatePayload(raw);
  if (result.ok || field(raw, 'lang') !== undefined) return result;
  return { ok: false, lang: fallbackLang };
}
