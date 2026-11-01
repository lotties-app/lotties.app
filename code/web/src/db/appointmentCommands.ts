import {
  APPOINTMENT_LIMITS,
  appointmentTermsOf,
  hasStarted,
  isAppointmentType,
  normalizeReminders,
  type AppointmentTerms,
} from '../appointments/appointmentModel';
import { toAppointmentUpsertRequest } from '../sync/contract';
import type { BabyRoutineDb } from './database';
import type { CommandOptions } from './eventCommands';
import type { Appointment } from './models';
import { enqueueMutation } from './outbox';

export type { AppointmentTerms } from '../appointments/appointmentModel';

/**
 * `title`: 1-80 characters are required; `startsAt`: not a time; `duration`: 5-480 minutes;
 * `notStarted`: marked done before its start; `gone`: the appointment is not on this device.
 */
export type InvalidAppointmentCode = 'title' | 'startsAt' | 'duration' | 'notStarted' | 'gone';

export class InvalidAppointmentError extends Error {
  readonly code: InvalidAppointmentCode;

  constructor(message: string, code: InvalidAppointmentCode) {
    super(message);
    this.name = 'InvalidAppointmentError';
    this.code = code;
  }
}

const optional = (value: string | null, max: number) => {
  const trimmed = value?.trim() ?? '';
  return trimmed === '' ? null : trimmed.slice(0, max);
};

function validDuration(minutes: number | null): number | null {
  if (minutes === null) return null;
  const whole = Math.round(minutes);
  if (whole < APPOINTMENT_LIMITS.minDuration || whole > APPOINTMENT_LIMITS.maxDuration) {
    throw new InvalidAppointmentError('A duration of 5 to 480 minutes is needed.', 'duration');
  }
  return whole;
}

/**
 * Trimmed terms the server accepts (the client mirror of the API rules): blank optional text is
 * absent, the start is a UTC instant, reminders are known offsets largest first, and `done` only
 * once the start has come.
 */
function normalized(terms: AppointmentTerms, now: number): AppointmentTerms {
  const title = terms.title.trim();
  if (!title || title.length > APPOINTMENT_LIMITS.title) {
    throw new InvalidAppointmentError(
      'An appointment needs a title of 1 to 80 characters.',
      'title',
    );
  }
  const start = Date.parse(terms.startsAt);
  if (!Number.isFinite(start)) {
    throw new InvalidAppointmentError('An appointment needs a start time.', 'startsAt');
  }
  const startsAt = new Date(start).toISOString();
  if (terms.status === 'done' && !hasStarted({ startsAt }, now)) {
    throw new InvalidAppointmentError(
      'Only an appointment that has started can be done.',
      'notStarted',
    );
  }
  return {
    title,
    type: isAppointmentType(terms.type) ? terms.type : 'other',
    startsAt,
    durationMinutes: validDuration(terms.durationMinutes),
    location: optional(terms.location, APPOINTMENT_LIMITS.location),
    doctorName: optional(terms.doctorName, APPOINTMENT_LIMITS.doctorName),
    notes: optional(terms.notes, APPOINTMENT_LIMITS.notes),
    outcome: optional(terms.outcome, APPOINTMENT_LIMITS.outcome),
    status: terms.status,
    reminderOffsetsMinutes: normalizeReminders(terms.reminderOffsetsMinutes),
  };
}

async function queueUpsert(db: BabyRoutineDb, a: Appointment, now: string) {
  await enqueueMutation(db, {
    babyId: a.babyId,
    kind: 'upsert',
    entityType: 'appointment',
    entityId: a.id,
    payload: toAppointmentUpsertRequest(a),
    createdAt: now,
  });
}

/** Adds an appointment locally and queues its upsert (`PUT /babies/{id}/appointments/{id}`). */
export async function createAppointment(
  db: BabyRoutineDb,
  babyId: string,
  terms: AppointmentTerms,
  options: CommandOptions = {},
): Promise<Appointment> {
  const clock = options.now?.() ?? new Date();
  const now = clock.toISOString();
  const appointment: Appointment = {
    ...normalized(terms, clock.getTime()),
    id: options.newId?.() ?? crypto.randomUUID(),
    babyId,
    createdBy: null,
    createdAt: now,
    updatedAt: now,
    clientUpdatedAt: now,
  };
  await db.transaction('rw', db.appointments, db.outbox, async () => {
    await db.appointments.put(appointment);
    await queueUpsert(db, appointment, now);
  });
  return appointment;
}

/** Replaces the terms of an appointment locally and queues its full state. */
export async function updateAppointment(
  db: BabyRoutineDb,
  id: string,
  terms: AppointmentTerms,
  options: CommandOptions = {},
): Promise<Appointment> {
  const clock = options.now?.() ?? new Date();
  const now = clock.toISOString();
  return db.transaction('rw', db.appointments, db.outbox, async () => {
    const current = await db.appointments.get(id);
    if (!current)
      throw new InvalidAppointmentError('This appointment is not on this device.', 'gone');
    const updated: Appointment = {
      ...current,
      ...normalized(terms, clock.getTime()),
      updatedAt: now,
      clientUpdatedAt: now,
    };
    await db.appointments.put(updated);
    await queueUpsert(db, updated, now);
    return updated;
  });
}

/** Changes one part of an appointment's state (status, outcome) and queues the full state. */
async function patchAppointment(
  db: BabyRoutineDb,
  id: string,
  patch: Partial<AppointmentTerms>,
  options: CommandOptions,
): Promise<Appointment> {
  return db.transaction('rw', db.appointments, db.outbox, async () => {
    const current = await db.appointments.get(id);
    if (!current)
      throw new InvalidAppointmentError('This appointment is not on this device.', 'gone');
    return updateAppointment(db, id, { ...appointmentTermsOf(current), ...patch }, options);
  });
}

/** Marks a visit that has started as done, with the optional outcome notes. */
export function markAppointmentDone(
  db: BabyRoutineDb,
  id: string,
  outcome: string | null,
  options: CommandOptions = {},
) {
  return patchAppointment(db, id, { status: 'done', outcome }, options);
}

/** Cancels an appointment (the soft delete: it stays listed and never reminds). */
export function cancelAppointment(db: BabyRoutineDb, id: string, options: CommandOptions = {}) {
  return patchAppointment(db, id, { status: 'cancelled' }, options);
}

/** Puts a cancelled or done appointment back to upcoming (Undo of a cancel). */
export function restoreAppointment(db: BabyRoutineDb, id: string, options: CommandOptions = {}) {
  return patchAppointment(db, id, { status: 'upcoming' }, options);
}
