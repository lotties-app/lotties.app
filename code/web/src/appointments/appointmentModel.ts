import type { Appointment, AppointmentStatus, AppointmentType, ReminderOffset } from '../db/models';

/*
 * Rules of a baby's appointments on the device (docs/design/15-appointments.md), mirroring the API's
 * `AppointmentTerms` and `Appointment`: limits, the reminder offsets, "done only once started", and
 * which appointment the Now card shows. Pure: no clock, no storage.
 */

export const APPOINTMENT_LIMITS = {
  title: 80,
  location: 200,
  doctorName: 80,
  notes: 2000,
  outcome: 2000,
  minDuration: 5,
  maxDuration: 480,
} as const;

export const APPOINTMENT_TYPES: readonly AppointmentType[] = [
  'consultation',
  'vaccine',
  'exam',
  'other',
];

/** Largest first, as the server stores them. */
export const REMINDER_OFFSETS: readonly ReminderOffset[] = [10080, 1440, 120, 30];

/** 1 day and 2 hours before: what a new appointment starts with (and the server's default). */
export const DEFAULT_REMINDERS: readonly ReminderOffset[] = [1440, 120];

/** Without a duration an appointment is shown (and exported) as one hour long. */
export const DEFAULT_LENGTH_MINUTES = 60;

/** The Now card shows the next appointment starting within this many days. */
export const NEXT_CARD_DAYS = 14;

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

/** The state a parent edits; ids, authorship and times are set by the commands. */
export type AppointmentTerms = Pick<
  Appointment,
  | 'title'
  | 'type'
  | 'startsAt'
  | 'durationMinutes'
  | 'location'
  | 'doctorName'
  | 'notes'
  | 'outcome'
  | 'status'
  | 'reminderOffsetsMinutes'
  | 'providerId'
>;

export function appointmentTermsOf(a: Appointment): AppointmentTerms {
  return {
    title: a.title,
    type: a.type,
    startsAt: a.startsAt,
    durationMinutes: a.durationMinutes,
    location: a.location,
    doctorName: a.doctorName,
    notes: a.notes,
    outcome: a.outcome,
    status: a.status,
    reminderOffsetsMinutes: a.reminderOffsetsMinutes,
    providerId: a.providerId ?? null,
  };
}

export function isReminderOffset(value: unknown): value is ReminderOffset {
  return REMINDER_OFFSETS.includes(value as ReminderOffset);
}

/** Known offsets only, each once, largest first; absent = the default (1 day, 2 hours). */
export function normalizeReminders(
  values: readonly unknown[] | null | undefined,
): ReminderOffset[] {
  if (!values) return [...DEFAULT_REMINDERS];
  return REMINDER_OFFSETS.filter((offset) => values.some((value) => value === offset));
}

const STATUSES: readonly AppointmentStatus[] = ['upcoming', 'done', 'cancelled'];

export function isAppointmentType(value: unknown): value is AppointmentType {
  return APPOINTMENT_TYPES.includes(value as AppointmentType);
}

export function isAppointmentStatus(value: unknown): value is AppointmentStatus {
  return STATUSES.includes(value as AppointmentStatus);
}

/** When the visit ends: start + duration, or one hour after the start without a duration. */
export function endOf(a: Pick<Appointment, 'startsAt' | 'durationMinutes'>): number {
  return Date.parse(a.startsAt) + (a.durationMinutes ?? DEFAULT_LENGTH_MINUTES) * MINUTE_MS;
}

/** "Mark as done" is offered (and accepted by the server) only once the start has come. */
export function hasStarted(a: Pick<Appointment, 'startsAt'>, now: number): boolean {
  return Date.parse(a.startsAt) <= now;
}

/** The gentle "Did it happen?" prompt: still upcoming after its start. */
export function needsOutcome(a: Pick<Appointment, 'startsAt' | 'status'>, now: number): boolean {
  return a.status === 'upcoming' && hasStarted(a, now);
}

const byStart = (a: Appointment, b: Appointment) =>
  a.startsAt.localeCompare(b.startsAt) || a.id.localeCompare(b.id);

/**
 * The agenda: upcoming appointments that have not ended yet, soonest first; then the rest (past,
 * done, cancelled, and upcoming ones whose time has passed), newest first.
 */
export function agendaOf(appointments: readonly Appointment[], now: number) {
  const ahead = (a: Appointment) => a.status === 'upcoming' && endOf(a) > now;
  const upcoming = appointments.filter(ahead).sort(byStart);
  const past = appointments.filter((a) => !ahead(a)).sort((a, b) => byStart(b, a));
  return { upcoming, past };
}

/**
 * The appointment of the Now card: the soonest upcoming one that has not ended and starts within
 * `NEXT_CARD_DAYS` days; `null` without one.
 */
export function nextAppointment(
  appointments: readonly Appointment[],
  now: number,
  withinDays = NEXT_CARD_DAYS,
): Appointment | null {
  const limit = now + withinDays * DAY_MS;
  return agendaOf(appointments, now).upcoming.find((a) => Date.parse(a.startsAt) <= limit) ?? null;
}
