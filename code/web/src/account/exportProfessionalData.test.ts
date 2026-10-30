import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BabyRoutineDb } from '../db/database';
import type { Baby, Note, Proposal } from '../db/models';
import { fakeApi, httpError, networkError, testDatabase } from '../test/fakeApi';
import { collectProfessionalData } from './exportProfessionalData';

/* The doctor's "Download my data": only what she produced, never her patients' records. Synthetic data. */

let db: BabyRoutineDb;

beforeEach(() => {
  db = testDatabase();
});

afterEach(async () => {
  await db.delete();
});

const patient = (id: string, doctorScopes?: Baby['doctorScopes']): Baby => ({
  id,
  name: `Patient ${id}`,
  birthDate: '2026-05-01',
  role: 'Doctor',
  userId: 'doc',
  doctorScopes,
});

const note = (id: string, babyId: string, authorUserId: string | null): Note => ({
  id,
  babyId,
  authorUserId,
  author: null,
  kind: 'note',
  visibility: 'private',
  body: `Note ${id}`,
  createdAt: '2026-10-01T10:00:00.000Z',
  updatedAt: '2026-10-01T10:00:00.000Z',
  deletedAt: null,
});

const proposal = (id: string, babyId: string, authorUserId: string): Proposal =>
  ({ id, babyId, authorUserId, author: null, status: 'pending' }) as unknown as Proposal;

const measurement = (id: string, babyId: string, createdBy: string) => ({
  id,
  babyId,
  date: '2026-10-01',
  weightKg: 6.1,
  heightCm: null,
  headCircumferenceCm: null,
  notes: null,
  createdBy,
  createdAt: '2026-10-01T10:00:00.000Z',
  updatedAt: '2026-10-01T10:00:00.000Z',
});

async function seed() {
  const own: Baby = {
    id: 'own',
    name: 'Nina',
    birthDate: '2026-09-01',
    role: 'Owner',
    userId: 'doc',
  };
  await db.babies.bulkPut([patient('p1'), patient('p2', ['daily_log', 'notes']), own]);
  await db.notes.bulkPut([
    note('mine', 'p1', 'doc'),
    note('pending', 'p1', null),
    note('family', 'p1', 'mom'),
    note('own-baby', 'own', 'doc'),
  ]);
  await db.proposals.bulkPut([proposal('suggested', 'p2', 'doc'), proposal('other', 'p2', 'dr-b')]);
}

describe('the doctor data download', () => {
  it('holds her profile, notes, proposals and measurements, and none of the family records', async () => {
    await seed();
    const { api, calls } = fakeApi((call) => {
      if (call.path === '/api/v1/me/professional-profile') {
        return {
          userId: 'doc',
          kind: 'doctor',
          displayName: 'Dr. Ana',
          specialty: 'Pediatrics',
          registrationNumber: null,
          verified: false,
          createdAt: 'x',
          updatedAt: 'x',
        };
      }
      if (call.path === '/api/v1/babies/p1/measurements') {
        return [measurement('m-doc', 'p1', 'doc'), measurement('m-mom', 'p1', 'mom')];
      }
      return undefined;
    });

    const data = await collectProfessionalData(db, api, new Date('2026-10-23T12:00:00Z'));

    expect(data.professionalProfile?.displayName).toBe('Dr. Ana');
    expect(data.notes.map((row) => row.id)).toEqual(['mine']);
    expect(data.proposals.map((row) => row.id)).toEqual(['suggested']);
    expect(data.measurements.map((row) => row.id)).toEqual(['m-doc']);
    // The patient without the growth section is not asked; the family's own baby never is.
    expect(calls.map((call) => call.path)).not.toContain('/api/v1/babies/p2/measurements');
    expect(calls.map((call) => call.path)).not.toContain('/api/v1/babies/own/measurements');
    expect(JSON.stringify(data)).not.toMatch(/Patient p1|Nina|events/);
  });

  it('has no profile before she declares one', async () => {
    const { api } = fakeApi((call) => {
      if (call.path === '/api/v1/me/professional-profile')
        throw httpError(404, 'professional_profile_not_found');
      return undefined;
    });

    expect((await collectProfessionalData(db, api)).professionalProfile).toBeNull();
  });

  it('fails when the server cannot be reached', async () => {
    const { api } = fakeApi(() => {
      throw networkError();
    });

    await expect(collectProfessionalData(db, api)).rejects.toThrow();
  });
});
