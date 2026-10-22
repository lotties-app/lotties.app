import type { BabyRoutineDb } from '../db/database';
import type { BabyRole, Note, PersonSummary, Proposal } from '../db/models';
import { BABY_ID } from '../test/fakeApi';
import { seedBaby } from '../test/seed';

/*
 * Test kit of the proposals feature (docs/design/16-doctor-access.md section 10): the doctor, the
 * proposals and recommendations a baby has, and the roles of the people looking at them. Synthetic
 * data only.
 */

export const DOCTOR_ID = 'doctor-1';
export const PARENT_ID = 'mom';

export const ANA: PersonSummary = {
  userId: DOCTOR_ID,
  displayName: 'Ana Souza',
  professional: {
    kind: 'doctor',
    displayName: 'Ana Souza',
    specialty: 'Pediatrics',
    registrationNumber: null,
    verified: false,
  },
};

export const VERIFIED_ANA: PersonSummary = {
  ...ANA,
  professional: { ...ANA.professional!, verified: true },
};

/** A pending proposal for Colidis, as the doctor sent it. */
export function proposal(id: string, extra: Partial<Proposal> = {}): Proposal {
  return {
    id,
    babyId: BABY_ID,
    authorUserId: DOCTOR_ID,
    author: ANA,
    medicationId: null,
    productId: null,
    medicationName: 'Colidis',
    kind: 'asNeeded',
    dose: { amount: 8, unit: 'drops', perKg: false, roundingStep: null },
    timesOfDay: null,
    everyMinutes: null,
    dayParts: null,
    dayPartReminders: null,
    minIntervalMinutes: 360,
    maxDosesPer24h: 4,
    indication: 'belly pain',
    intervalGroup: null,
    startDate: '2026-10-22',
    endDate: '2026-11-05',
    instructions: 'Give it after the feed.',
    replacesPrescriptionId: null,
    status: 'pending',
    declineReason: null,
    cancelReason: null,
    decidedBy: null,
    decidedAt: null,
    acceptedPrescriptionId: null,
    createdAt: '2026-10-22T09:00:00.000Z',
    updatedAt: '2026-10-22T09:00:00.000Z',
    clientUpdatedAt: '2026-10-22T09:00:00.000Z',
    ...extra,
  };
}

export function recommendation(id: string, extra: Partial<Note> = {}): Note {
  return {
    id,
    babyId: BABY_ID,
    authorUserId: DOCTOR_ID,
    author: ANA,
    kind: 'recommendation',
    visibility: 'shared',
    body: `Body of ${id}`,
    createdAt: '2026-10-22T08:00:00.000Z',
    updatedAt: '2026-10-22T08:00:00.000Z',
    clientUpdatedAt: '2026-10-22T08:00:00.000Z',
    deletedAt: null,
    ...extra,
  };
}

/** The baby of the tests for `role`, with the user's server id (the doctor's, or a parent's). */
export function babyFor(role: BabyRole) {
  return {
    id: BABY_ID,
    name: 'Lia',
    birthDate: '2026-08-01',
    role,
    userId: role === 'Doctor' ? DOCTOR_ID : PARENT_ID,
  };
}

export async function seedFamily(db: BabyRoutineDb, role: BabyRole = 'Owner') {
  await seedBaby(db, { medications: true, role, userId: babyFor(role).userId });
  return babyFor(role);
}

export const MEMBERS = [
  { userId: PARENT_ID, displayName: 'Carla', role: 'Owner', joinedAt: '2026-08-01T10:00:00Z' },
  {
    userId: DOCTOR_ID,
    displayName: 'ana',
    role: 'Doctor',
    joinedAt: '2026-10-01T10:00:00Z',
    professional: ANA.professional,
  },
];
