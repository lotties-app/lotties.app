import type { Appointment, CareProvider } from '../db/models';
import { singleLineAddress } from '../providers/providerModel';
import { endOf } from './appointmentModel';
import { dayKeyOf } from './calendarModel';

/*
 * One appointment as an iCalendar file (RFC 5545) for "Add to calendar": a VCALENDAR with one
 * VEVENT (UID `{id}@lotties.app`, times in UTC, the doctor and notes in the description) and one
 * VALARM per reminder offset. Pure: the caller passes the clock and the translated labels.
 * Lines end with CRLF and are folded at 75 octets of UTF-8 (never inside a character).
 */

export interface IcsLabels {
  /** "Doctor" before the doctor's name in the description. */
  doctor: string;
  /** "Phone" before the provider's phone in the description (only needed with a provider). */
  phone?: string;
}

export interface IcsOptions {
  /** The export time (DTSTAMP). */
  now: Date;
  labels: IcsLabels;
  /**
   * The care provider the appointment links to, when it is still on the device
   * (docs/design/22-care-providers.md): its address completes the LOCATION and its phone joins
   * the description.
   */
  provider?: Pick<CareProvider, 'address' | 'phone'> | null;
}

const CRLF = '\r\n';
const MAX_OCTETS = 75;
const encoder = new TextEncoder();

/** `20260304T183000Z`: a UTC date-time in the basic format RFC 5545 asks for. */
export function icsDateTime(instant: number | string | Date): string {
  const date = new Date(instant instanceof Date ? instant.getTime() : instant);
  return date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
}

/** TEXT value escaping: backslash, semicolon, comma and line breaks. */
export function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

/**
 * Folds a content line into lines of at most 75 octets: the first holds up to 75, each
 * continuation starts with one space and holds up to 74 more, splitting only between characters.
 */
export function foldLine(line: string): string {
  const parts: string[] = [];
  let current = '';
  let octets = 0;
  for (const char of line) {
    const size = encoder.encode(char).length;
    const limit = parts.length === 0 ? MAX_OCTETS : MAX_OCTETS - 1;
    if (octets + size > limit) {
      parts.push(current);
      current = '';
      octets = 0;
    }
    current += char;
    octets += size;
  }
  parts.push(current);
  return parts.join(`${CRLF} `);
}

const statusOf = (a: Appointment) => (a.status === 'cancelled' ? 'CANCELLED' : 'CONFIRMED');

/**
 * The place: the appointment's own text, completed with the linked provider's address on one line
 * unless the text already holds it (a picked provider copies it, so usually it does).
 */
export function locationOf(
  a: Pick<Appointment, 'location'>,
  provider?: IcsOptions['provider'],
): string | null {
  const place = a.location?.trim() ?? '';
  const address = singleLineAddress(provider?.address);
  if (!address || place.includes(address)) return place || null;
  return place ? `${place}, ${address}` : address;
}

function descriptionOf(
  a: Appointment,
  labels: IcsLabels,
  provider?: IcsOptions['provider'],
): string | null {
  const phone = provider?.phone?.trim();
  const lines = [
    a.doctorName ? `${labels.doctor}: ${a.doctorName}` : null,
    phone ? `${labels.phone ?? 'Phone'}: ${phone}` : null,
    a.notes,
  ].filter((line): line is string => !!line);
  return lines.length > 0 ? lines.join('\n') : null;
}

function alarmLines(a: Appointment): string[] {
  return a.reminderOffsetsMinutes.flatMap((offset) => [
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    `DESCRIPTION:${escapeText(a.title)}`,
    `TRIGGER:-PT${offset}M`,
    'END:VALARM',
  ]);
}

/** The `.ics` text of one appointment. */
export function appointmentToIcs(a: Appointment, { now, labels, provider }: IcsOptions): string {
  const description = descriptionOf(a, labels, provider);
  const location = locationOf(a, provider);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Lotties//Appointments//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${a.id}@lotties.app`,
    `DTSTAMP:${icsDateTime(now)}`,
    `DTSTART:${icsDateTime(a.startsAt)}`,
    `DTEND:${icsDateTime(endOf(a))}`,
    `SUMMARY:${escapeText(a.title)}`,
    ...(location ? [`LOCATION:${escapeText(location)}`] : []),
    ...(description ? [`DESCRIPTION:${escapeText(description)}`] : []),
    `STATUS:${statusOf(a)}`,
    `LAST-MODIFIED:${icsDateTime(a.updatedAt)}`,
    ...alarmLines(a),
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.map(foldLine).join(CRLF) + CRLF;
}

/** `lotties-appointment-2026-03-04.ics`, from the start's local date (no names in file names). */
export function icsFileName(a: Pick<Appointment, 'startsAt'>, timeZone?: string): string {
  return `lotties-appointment-${dayKeyOf(a.startsAt, timeZone)}.ics`;
}
