import { describe, expect, it } from 'vitest';
import type { BabyRole } from '../db/models';
import { fromBabyDto, parseRole } from '../sync/contract';
import {
  canChangeEvent,
  canChangeMeasurement,
  canLog,
  canRecordMeasurements,
  canWrite,
  canWriteNotes,
  isDoctor,
} from './permissions';
import {
  canMakePrivate,
  doctorNameOf,
  isOwnNote,
  sharedNotesBy,
  timelineOf,
} from '../notes/noteModel';
import type { Note } from '../db/models';

/* The Doctor role on the device (docs/design/16-doctor-access.md); the server enforces it too. */

const ROLES: BabyRole[] = ['Owner', 'Parent', 'Caregiver', 'Viewer', 'Doctor'];

describe('doctor role rules', () => {
  it.each([
    ['Owner', true, true, false, true],
    ['Parent', true, true, false, true],
    ['Caregiver', false, true, false, false],
    ['Viewer', false, false, false, false],
    ['Doctor', false, false, true, true],
  ] as const)(
    '%s: write %s, log %s, notes %s, measurements %s',
    (role, write, log, notes, measure) => {
      const baby = { role };
      expect([
        canWrite(baby),
        canLog(baby),
        canWriteNotes(baby),
        canRecordMeasurements(baby),
      ]).toEqual([write, log, notes, measure]);
    },
  );

  it('lets the Doctor change only her own measurements, and no event', () => {
    const doctor = { role: 'Doctor' as const, userId: 'doc' };
    expect(canChangeMeasurement(doctor, { createdBy: 'doc' })).toBe(true);
    expect(canChangeMeasurement(doctor, { createdBy: 'mom' })).toBe(false);
    expect(canChangeMeasurement({ role: 'Parent', userId: 'dad' }, { createdBy: 'doc' })).toBe(
      true,
    );
    expect(canChangeEvent(doctor, { createdBy: null })).toBe(false);
    expect(ROLES.filter((role) => isDoctor({ role }))).toEqual(['Doctor']);
  });

  it('reads the Doctor role from the API, any case', () => {
    expect(parseRole('doctor')).toBe('Doctor');
    expect(
      fromBabyDto({ id: 'b', name: 'Lia', birthDate: '2026-08-01', role: 'Doctor' }).role,
    ).toBe('Doctor');
  });
});

const note = (id: string, extra: Partial<Note> = {}): Note => ({
  id,
  babyId: 'b',
  authorUserId: 'doc',
  author: null,
  kind: 'note',
  visibility: 'shared',
  body: id,
  createdAt: '2026-10-20T10:00:00.000Z',
  updatedAt: '2026-10-20T10:00:00.000Z',
  deletedAt: null,
  ...extra,
});

describe('note model', () => {
  it('lists the notes newest first without the deleted ones', () => {
    const list = timelineOf([
      note('old', { createdAt: '2026-10-19T10:00:00.000Z' }),
      note('gone', { deletedAt: '2026-10-21T10:00:00.000Z' }),
      note('new', { createdAt: '2026-10-21T10:00:00.000Z' }),
    ]);
    expect(list.map((n) => n.id)).toEqual(['new', 'old']);
  });

  it('knows the own notes, the shared count and that a shared note stays shared', () => {
    expect(isOwnNote({ userId: 'doc' }, note('a'))).toBe(true);
    expect(isOwnNote({ userId: 'doc' }, note('a', { authorUserId: null }))).toBe(true);
    expect(isOwnNote({ userId: 'mom' }, note('a'))).toBe(false);
    expect(
      sharedNotesBy(
        [note('a'), note('b', { visibility: 'private' }), note('c', { authorUserId: 'x' })],
        'doc',
      ),
    ).toBe(1);
    expect([
      canMakePrivate(undefined),
      canMakePrivate(note('a')),
      canMakePrivate(note('a', { visibility: 'private' })),
    ]).toEqual([true, false, true]);
  });

  it.each([
    ['Ana Souza', 'Ana Souza'],
    ['Dra. Ana Souza', 'Ana Souza'],
    ['Dr Rui Lima', 'Rui Lima'],
    ['Dr(a). Bia', 'Bia'],
    ['Doutora Ana', 'Ana'],
    ['Dr.', 'Dr.'],
  ])('names %s as %s after the title', (declared, shown) => {
    expect(
      doctorNameOf({
        displayName: 'account',
        professional: {
          kind: 'doctor',
          displayName: declared,
          specialty: null,
          registrationNumber: null,
          verified: false,
        },
      }),
    ).toBe(shown);
  });
});
