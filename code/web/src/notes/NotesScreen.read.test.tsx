import { screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BabyRoutineDb } from '../db/database';
import type { BabyRole } from '../db/models';
import { ANA, babyFor, recommendation, seedFamily } from '../proposals/proposalKit';
import { fakeApi, testDatabase } from '../test/fakeApi';
import { renderWithDb, settleSync } from '../test/renderApp';
import { NotesScreen } from './NotesScreen';

/*
 * Opening the notes is reading the recommendations in them (docs/design/16-doctor-access.md section
 * 10.3): for the Owners and Parents they are marked read, so the inbox and the badge let go of them.
 */

let db: BabyRoutineDb;

beforeEach(() => {
  db = testDatabase();
});

afterEach(async () => {
  await settleSync();
  await db.delete();
});

async function renderNotes(role: BabyRole) {
  await seedFamily(db, role);
  renderWithDb(db, <NotesScreen baby={babyFor(role)} />, { api: fakeApi().api });
  await screen.findByRole('heading', { name: 'Notes' });
}

describe('opening the notes', () => {
  it.each<BabyRole>(['Owner', 'Parent'])(
    'marks the unread recommendations read for a %s, once each, and queues the reads',
    async (role) => {
      await db.notes.bulkPut([
        recommendation('r1'),
        recommendation('r2'),
        recommendation('r3', { kind: 'note' }),
        recommendation('r4', { author: ANA, visibility: 'private' }),
      ]);
      await db.noteReads.put({
        noteId: 'r2',
        babyId: 'baby-1',
        readAt: '2026-10-22T10:00:00.000Z',
      });
      await renderNotes(role);

      await waitFor(async () => expect(await db.noteReads.get('r1')).toBeTruthy());
      expect((await db.noteReads.toArray()).map((r) => r.noteId).sort()).toEqual(['r1', 'r2']);
      expect((await db.outbox.toArray()).map((m) => [m.entityType, m.entityId])).toEqual([
        ['noteRead', 'read:r1'],
      ]);
    },
  );

  it.each<BabyRole>(['Caregiver', 'Viewer', 'Doctor'])(
    'leaves the reads alone for a %s',
    async (role) => {
      await db.notes.put(recommendation('r1'));
      await renderNotes(role);

      await screen.findByText('Body of r1');
      expect(await db.noteReads.count()).toBe(0);
      expect(await db.outbox.count()).toBe(0);
    },
  );
});
