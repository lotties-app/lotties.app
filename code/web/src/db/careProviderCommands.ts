import {
  PROVIDER_LIMITS,
  careProviderTermsOf,
  type CareProviderTerms,
} from '../providers/providerModel';
import { toCareProviderUpsertRequest } from '../sync/contract';
import type { BabyRoutineDb } from './database';
import type { CommandOptions } from './eventCommands';
import type { CareProvider } from './models';
import { enqueueMutation } from './outbox';

export type { CareProviderTerms } from '../providers/providerModel';

/** `name`: a name of 1-80 characters is required; `gone`: the provider is not on this device. */
export type InvalidCareProviderCode = 'name' | 'gone';

export class InvalidCareProviderError extends Error {
  readonly code: InvalidCareProviderCode;

  constructor(message: string, code: InvalidCareProviderCode = 'name') {
    super(message);
    this.name = 'InvalidCareProviderError';
    this.code = code;
  }
}

const optional = (value: string | null, max: number) => {
  const trimmed = value?.trim() ?? '';
  return trimmed === '' ? null : trimmed.slice(0, max);
};

/**
 * Trimmed terms the server accepts (the client mirror of the API rules): blank optional text is
 * absent. A website that names a scheme other than http(s) is dropped rather than sent (the server
 * would refuse it).
 */
function normalized(terms: CareProviderTerms): CareProviderTerms {
  const name = terms.name.trim();
  if (!name || name.length > PROVIDER_LIMITS.name) {
    throw new InvalidCareProviderError('A provider needs a name of 1 to 80 characters.');
  }
  const website = optional(terms.website, PROVIDER_LIMITS.website);
  return {
    name,
    specialty: optional(terms.specialty, PROVIDER_LIMITS.specialty),
    registrationCouncil: optional(terms.registrationCouncil, PROVIDER_LIMITS.registrationCouncil),
    registrationNumber: optional(terms.registrationNumber, PROVIDER_LIMITS.registrationNumber),
    registrationRegion: optional(terms.registrationRegion, PROVIDER_LIMITS.registrationRegion),
    clinicName: optional(terms.clinicName, PROVIDER_LIMITS.clinicName),
    address: optional(terms.address, PROVIDER_LIMITS.address),
    phone: optional(terms.phone, PROVIDER_LIMITS.phone),
    whatsapp: optional(terms.whatsapp, PROVIDER_LIMITS.whatsapp),
    email: optional(terms.email, PROVIDER_LIMITS.email),
    website:
      website && /^[a-z][a-z0-9+.-]*:(?!\d)/i.test(website) && !/^https?:\/\//i.test(website)
        ? null
        : website,
    notes: optional(terms.notes, PROVIDER_LIMITS.notes),
    favorite: terms.favorite && !terms.deleted,
    deleted: terms.deleted,
  };
}

async function queueUpsert(db: BabyRoutineDb, p: CareProvider, now: string) {
  await enqueueMutation(db, {
    babyId: p.babyId,
    kind: 'upsert',
    entityType: 'careProvider',
    entityId: p.id,
    payload: toCareProviderUpsertRequest(p),
    createdAt: now,
  });
}

/** Adds a provider locally and queues its upsert (`PUT /babies/{id}/care-providers/{id}`). */
export async function createCareProvider(
  db: BabyRoutineDb,
  babyId: string,
  terms: CareProviderTerms,
  options: CommandOptions = {},
): Promise<CareProvider> {
  const now = (options.now?.() ?? new Date()).toISOString();
  const provider: CareProvider = {
    ...normalized(terms),
    id: options.newId?.() ?? crypto.randomUUID(),
    babyId,
    createdBy: null,
    createdAt: now,
    updatedAt: now,
    clientUpdatedAt: now,
  };
  await db.transaction('rw', db.careProviders, db.outbox, async () => {
    await db.careProviders.put(provider);
    await queueUpsert(db, provider, now);
  });
  return provider;
}

/** Replaces the terms of a provider locally and queues its full state. */
export async function updateCareProvider(
  db: BabyRoutineDb,
  id: string,
  terms: CareProviderTerms,
  options: CommandOptions = {},
): Promise<CareProvider> {
  const now = (options.now?.() ?? new Date()).toISOString();
  return db.transaction('rw', db.careProviders, db.outbox, async () => {
    const current = await db.careProviders.get(id);
    if (!current) {
      throw new InvalidCareProviderError('This provider is not on this device.', 'gone');
    }
    const updated: CareProvider = {
      ...current,
      ...normalized(terms),
      updatedAt: now,
      clientUpdatedAt: now,
    };
    await db.careProviders.put(updated);
    await queueUpsert(db, updated, now);
    return updated;
  });
}

async function patchCareProvider(
  db: BabyRoutineDb,
  id: string,
  patch: Partial<CareProviderTerms>,
  options: CommandOptions,
): Promise<CareProvider> {
  return db.transaction('rw', db.careProviders, db.outbox, async () => {
    const current = await db.careProviders.get(id);
    if (!current) {
      throw new InvalidCareProviderError('This provider is not on this device.', 'gone');
    }
    return updateCareProvider(db, id, { ...careProviderTermsOf(current), ...patch }, options);
  });
}

/** Marks or unmarks a provider as a favorite (favorites are listed first). */
export function setCareProviderFavorite(
  db: BabyRoutineDb,
  id: string,
  favorite: boolean,
  options: CommandOptions = {},
) {
  return patchCareProvider(db, id, { favorite }, options);
}

/** The soft delete: the provider leaves the list, appointments keep the text they copied. */
export function deleteCareProvider(db: BabyRoutineDb, id: string, options: CommandOptions = {}) {
  return patchCareProvider(db, id, { deleted: true, favorite: false }, options);
}

/** Puts a deleted provider back on the list (Undo of a delete). */
export function restoreCareProvider(db: BabyRoutineDb, id: string, options: CommandOptions = {}) {
  return patchCareProvider(db, id, { deleted: false }, options);
}
