import { dayKeyOf } from '../appointments/calendarModel';
import { toVaccinationUpsertRequest } from '../sync/contract';
import {
  EARLIEST_GIVEN_ON,
  VACCINATION_LIMITS,
  isCalendarDate,
  isSlug,
  isVaccineNetwork,
  vaccinationTermsOf,
  type VaccinationTerms,
} from '../vaccines/vaccinationModel';
import type { BabyRoutineDb } from './database';
import type { CommandOptions } from './eventCommands';
import type { Vaccination } from './models';
import { enqueueMutation } from './outbox';

export type { VaccinationTerms } from '../vaccines/vaccinationModel';

/**
 * `vaccineKey`/`doseId`: not a schedule key; `customName`: 1-80 characters are required without a
 * vaccine and not allowed with one; `givenOn`: not a date from 2000 up to today; `network`: neither
 * public nor private; `gone`: the record is not on this device.
 */
export type InvalidVaccinationCode =
  'vaccineKey' | 'doseId' | 'customName' | 'givenOn' | 'network' | 'gone';

export class InvalidVaccinationError extends Error {
  readonly code: InvalidVaccinationCode;

  constructor(message: string, code: InvalidVaccinationCode) {
    super(message);
    this.name = 'InvalidVaccinationError';
    this.code = code;
  }
}

/** Trimmed text without NUL characters; blank is absent. */
const clean = (value: string | null | undefined): string | null => {
  const text = (value ?? '').replaceAll('\u0000', '').trim();
  return text === '' ? null : text;
};

/** Optional text the server accepts: cleaned, and cut at its limit. */
const text = (value: string | null | undefined, max: number): string | null => {
  const cleaned = clean(value);
  return cleaned === null ? null : cleaned.slice(0, max).trim();
};

/**
 * Trimmed terms the server accepts (the client mirror of the API rules): a vaccine is a schedule
 * key (with an optional dose id) or a custom name, never both; the date is a real day from 2000 up
 * to the device's today; blank optional text is absent.
 */
export function normalizedVaccination(terms: VaccinationTerms, today: string): VaccinationTerms {
  // Keys are never cut: a key that is too long is not a schedule key.
  const vaccineKey = clean(terms.vaccineKey);
  if (vaccineKey !== null && !isSlug(vaccineKey, VACCINATION_LIMITS.vaccineKey)) {
    throw new InvalidVaccinationError('The vaccine key is not valid.', 'vaccineKey');
  }
  const doseId = clean(terms.doseId);
  if (doseId !== null && (vaccineKey === null || !isSlug(doseId, VACCINATION_LIMITS.doseId))) {
    throw new InvalidVaccinationError('The dose id is not valid.', 'doseId');
  }
  const customName = text(terms.customName, VACCINATION_LIMITS.customName);
  if ((vaccineKey === null) === (customName === null)) {
    throw new InvalidVaccinationError(
      'A vaccine needs either a schedule key or a name of 1 to 80 characters, not both.',
      'customName',
    );
  }
  if (
    !isCalendarDate(terms.givenOn) ||
    terms.givenOn < EARLIEST_GIVEN_ON ||
    terms.givenOn > today
  ) {
    throw new InvalidVaccinationError(
      'The date given must be a day from 2000 up to today.',
      'givenOn',
    );
  }
  if (!isVaccineNetwork(terms.network)) {
    throw new InvalidVaccinationError('Where it was given is public or private.', 'network');
  }
  return {
    vaccineKey,
    doseId,
    customName,
    doseLabel: text(terms.doseLabel, VACCINATION_LIMITS.doseLabel),
    givenOn: terms.givenOn,
    network: terms.network,
    clinic: text(terms.clinic, VACCINATION_LIMITS.clinic),
    lot: text(terms.lot, VACCINATION_LIMITS.lot),
    administeredBy: text(terms.administeredBy, VACCINATION_LIMITS.administeredBy),
    notes: text(terms.notes, VACCINATION_LIMITS.notes),
  };
}

async function queueUpsert(db: BabyRoutineDb, v: Vaccination, now: string) {
  await enqueueMutation(db, {
    babyId: v.babyId,
    kind: 'upsert',
    entityType: 'vaccination',
    entityId: v.id,
    payload: toVaccinationUpsertRequest(v),
    createdAt: now,
  });
}

/** Records a vaccine locally and queues its upsert (`PUT /babies/{id}/vaccinations/{id}`). */
export async function createVaccination(
  db: BabyRoutineDb,
  babyId: string,
  terms: VaccinationTerms,
  options: CommandOptions = {},
): Promise<Vaccination> {
  const clock = options.now?.() ?? new Date();
  const now = clock.toISOString();
  const vaccination: Vaccination = {
    ...normalizedVaccination(terms, dayKeyOf(clock.getTime())),
    id: options.newId?.() ?? crypto.randomUUID(),
    babyId,
    createdBy: null,
    createdAt: now,
    updatedAt: now,
    clientUpdatedAt: now,
    deletedAt: null,
  };
  await db.transaction('rw', db.vaccinations, db.outbox, async () => {
    await db.vaccinations.put(vaccination);
    await queueUpsert(db, vaccination, now);
  });
  return vaccination;
}

/** Replaces the terms of a record locally and queues its full state (it absorbs a queued earlier edit). */
export async function updateVaccination(
  db: BabyRoutineDb,
  id: string,
  terms: VaccinationTerms,
  options: CommandOptions = {},
): Promise<Vaccination> {
  const clock = options.now?.() ?? new Date();
  const now = clock.toISOString();
  const next = normalizedVaccination(terms, dayKeyOf(clock.getTime()));
  return db.transaction('rw', db.vaccinations, db.outbox, async () => {
    const current = await db.vaccinations.get(id);
    if (!current || current.deletedAt !== null) {
      throw new InvalidVaccinationError('This record is not on this device.', 'gone');
    }
    const updated: Vaccination = { ...current, ...next, updatedAt: now, clientUpdatedAt: now };
    await db.vaccinations.put(updated);
    await queueUpsert(db, updated, now);
    return updated;
  });
}

/**
 * Soft deletes a record locally and queues `DELETE /babies/{id}/vaccinations/{id}`. Returns its
 * terms (for an Undo, which records them again under a new id: deletes are final on the server), or
 * `undefined` when it was not there.
 */
export async function deleteVaccination(
  db: BabyRoutineDb,
  id: string,
  options: CommandOptions = {},
): Promise<VaccinationTerms | undefined> {
  const now = (options.now?.() ?? new Date()).toISOString();
  return db.transaction('rw', db.vaccinations, db.outbox, async () => {
    const current = await db.vaccinations.get(id);
    if (!current || current.deletedAt !== null) return undefined;
    await db.vaccinations.put({ ...current, deletedAt: now, updatedAt: now, clientUpdatedAt: now });
    await enqueueMutation(db, {
      babyId: current.babyId,
      kind: 'delete',
      entityType: 'vaccination',
      entityId: id,
      payload: null,
      createdAt: now,
    });
    return vaccinationTermsOf(current);
  });
}
