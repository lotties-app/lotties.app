import type { Appointment } from '../db/models';
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
}

export interface IcsOptions {
  /** The export time (DTSTAMP). */
  now: Date;
  labels: IcsLabels;
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

function descriptionOf(a: Appointment, labels: IcsLabels): string | null {
  const lines = [a.doctorName ? `${labels.doctor}: ${a.doctorName}` : null, a.notes].filter(
    (line): line is string => !!line,
  );
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
export function appointmentToIcs(a: Appointment, { now, labels }: IcsOptions): string {
  const description = descriptionOf(a, labels);
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
    ...(a.location ? [`LOCATION:${escapeText(a.location)}`] : []),
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
