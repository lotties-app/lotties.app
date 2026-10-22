import { screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BabyRoutineDb } from '../db/database';
import { SyncSection } from '../settings/SyncSection';
import { BABY_ID, fakeApi, testDatabase } from '../test/fakeApi';
import { useTestLocale } from '../test/locale';
import { renderWithDb, settleSync } from '../test/renderApp';

/* Settings > Sync names the changes of the doctor's suggestions that the server refused. */

let db: BabyRoutineDb;

beforeEach(() => {
  db = testDatabase();
});

afterEach(async () => {
  await settleSync();
  await db.delete();
});

async function putDead(
  entityType: 'proposal' | 'proposalDecision' | 'noteRead',
  kind: 'upsert' | 'delete',
) {
  await db.outbox.add({
    babyId: BABY_ID,
    kind,
    entityType,
    entityId: 'x',
    payload: null,
    createdAt: '2026-10-22T10:00:00.000Z',
    attempts: 1,
    lastError: 'This suggestion was already decided.',
    status: 'dead',
    nextAttemptAt: null,
  });
}

describe('failed changes of the doctor suggestions', () => {
  it('reads a refused decision and a refused withdraw by name', async () => {
    await putDead('proposalDecision', 'upsert');
    await putDead('proposal', 'delete');
    renderWithDb(db, <SyncSection />, { api: fakeApi().api });

    expect(await screen.findByText('Save decision on a suggestion')).toBeTruthy();
    expect(screen.getByText('Delete proposal')).toBeTruthy();
    expect(screen.getAllByText('This suggestion was already decided.')).toHaveLength(2);
  });

  it('reads the same in Portuguese', async () => {
    await useTestLocale('pt-BR');
    await putDead('proposalDecision', 'upsert');
    renderWithDb(db, <SyncSection />, { api: fakeApi().api });

    expect(await screen.findByText('Salvar decisão sobre uma sugestão')).toBeTruthy();
  });
});
