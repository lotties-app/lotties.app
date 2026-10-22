import type { Baby, BabyEvent } from '../db/models';
import { PAUSE_KEYS, withPause, withResume } from '../timers/pauseMath';
import { getOwn } from '../util/ownProperty';

/*
 * What the current user may do with a baby, from their role (docs/SPEC.md "Roles and
 * permissions"). The server enforces every rule; these only decide what the UI offers.
 * Owner > Parent > Caregiver > Viewer.
 */

/**
 * Owners and Parents change everything the baby has: events of anyone, event types, medications,
 * prescriptions, measurements and imports.
 */
export function canWrite(baby: Pick<Baby, 'role'>): boolean {
  return baby.role === 'Owner' || baby.role === 'Parent';
}

/** Owners, Parents and Caregivers log events (and get reminders); Viewers only read. */
export function canLog(baby: Pick<Baby, 'role'>): boolean {
  return canWrite(baby) || baby.role === 'Caregiver';
}

/** A Caregiver logs events and changes only their own; manages nothing else. */
export function isCaregiver(baby: Pick<Baby, 'role'>): boolean {
  return baby.role === 'Caregiver';
}

/** Owners edit the baby, manage members and invites. */
export function isOwner(baby: Pick<Baby, 'role'>): boolean {
  return baby.role === 'Owner';
}

/**
 * The baby's Doctor (docs/design/16-doctor-access.md): reads like a Viewer, writes her own notes and
 * consultation measurements, logs nothing and gets no reminders.
 */
export function isDoctor(baby: Pick<Baby, 'role'>): boolean {
  return baby.role === 'Doctor';
}

/** Only the Doctor writes notes in v1 (and changes only her own). */
export function canWriteNotes(baby: Pick<Baby, 'role'>): boolean {
  return isDoctor(baby);
}

/**
 * Only the Doctor suggests prescriptions (docs/design/16-doctor-access.md section 10): she never
 * writes the baby's prescriptions or medications, the parents decide.
 */
export function canPropose(baby: Pick<Baby, 'role'>): boolean {
  return isDoctor(baby);
}

/** Owners and Parents accept or decline a doctor's suggestion and get her recommendations. */
export function canDecideProposals(baby: Pick<Baby, 'role'>): boolean {
  return canWrite(baby);
}

/** Owners and Parents add measurements, and the Doctor her consultation measurements. */
export function canRecordMeasurements(baby: Pick<Baby, 'role'>): boolean {
  return canWrite(baby) || isDoctor(baby);
}

/** Whether the user may edit or delete the measurement: any for Owners and Parents, her own for the Doctor. */
export function canChangeMeasurement(
  baby: Pick<Baby, 'role' | 'userId'>,
  measurement: { createdBy: string | null },
): boolean {
  if (canWrite(baby)) return true;
  return isDoctor(baby) && !!baby.userId && measurement.createdBy === baby.userId;
}

/**
 * Whether the event was logged by the current user: not synced yet (`createdBy` null: only this
 * account's own changes live in this device's store) or created by `baby.userId`. Unknown when
 * the user's id is not known yet: then only unsynced events count as theirs.
 */
export function isOwnEvent(
  baby: Pick<Baby, 'userId'>,
  event: Pick<BabyEvent, 'createdBy'>,
): boolean {
  if (event.createdBy === null) return true;
  return !!baby.userId && event.createdBy === baby.userId;
}

/** Whether the current user may edit or delete `event`: any for Owners and Parents, own ones for Caregivers. */
export function canChangeEvent(
  baby: Pick<Baby, 'role' | 'userId'>,
  event: Pick<BabyEvent, 'createdBy'>,
): boolean {
  if (canWrite(baby)) return true;
  return canLog(baby) && isOwnEvent(baby, event);
}

/** Timer commands' reach: how far ahead of the clock a stop may end (the API's client clock skew). */
const MAX_FUTURE_END_MS = 5 * 60_000;

const isEmptyValue = (value: unknown) => value === undefined || value === null || value === '';

/** Structural JSON equality: member order ignored, array order kept. */
function jsonEquivalent(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (typeof left !== 'object' || typeof right !== 'object' || left === null || right === null) {
    return false;
  }
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key) =>
        Object.hasOwn(right, key) &&
        jsonEquivalent(
          getOwn(left as Record<string, unknown>, key),
          getOwn(right as Record<string, unknown>, key),
        ),
    )
  );
}

/**
 * Whether `next` only stops, pauses or resumes the running `stored` event and fills what was empty:
 * the one change a Caregiver may make to someone else's entry (mirrors the API's
 * `RunningEventControl`). Same type, start and note; an end at or after the start and not past
 * `now` + 5 min (or still running); the pause keys may change; every other stored value that is not
 * empty (absent, `null`, `''`) stays.
 */
export function isRunningControlChange(
  stored: Pick<BabyEvent, 'typeId' | 'startedAt' | 'endedAt' | 'payload' | 'notes' | 'deletedAt'>,
  next: Pick<BabyEvent, 'typeId' | 'startedAt' | 'endedAt' | 'payload' | 'notes'>,
  now: number = Date.now(),
): boolean {
  if (stored.endedAt !== null || stored.deletedAt !== null) return false;
  if (next.typeId !== stored.typeId) return false;
  if (Date.parse(next.startedAt) !== Date.parse(stored.startedAt)) return false;
  if ((next.notes?.trim() || null) !== (stored.notes?.trim() || null)) return false;
  if (next.endedAt !== null) {
    const end = Date.parse(next.endedAt);
    if (!(end >= Date.parse(stored.startedAt) && end <= now + MAX_FUTURE_END_MS)) return false;
  }
  return Object.keys(stored.payload).every(
    (key) =>
      PAUSE_KEYS.includes(key) ||
      isEmptyValue(getOwn(stored.payload, key)) ||
      (Object.hasOwn(next.payload, key) &&
        jsonEquivalent(getOwn(stored.payload, key), getOwn(next.payload, key))),
  );
}

/**
 * Whether the user may stop, pause and resume the running `event`: anyone who may change it, and a
 * Caregiver when the pause and the resume stay within `isRunningControlChange` (a nursing session
 * moves its side clock on resume, so someone else's stays locked).
 */
export function canControlTimer(
  baby: Pick<Baby, 'role' | 'userId'>,
  event: BabyEvent,
  now: number = Date.now(),
): boolean {
  if (canChangeEvent(baby, event)) return true;
  if (!canLog(baby) || event.endedAt !== null || event.deletedAt !== null) return false;
  const paused = { ...event, payload: withPause(event.payload, now) };
  const resumed = { ...event, payload: withResume(paused.payload, now + 60_000) };
  return isRunningControlChange(event, paused, now) && isRunningControlChange(event, resumed, now);
}
