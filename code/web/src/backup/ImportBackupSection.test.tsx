import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/ApiError';
import { useSelectedBaby } from '../baby/SelectedBabyContext';
import type { BabyRoutineDb } from '../db/database';
import type { BabyRole } from '../db/models';
import { BABY_ID, fakeApi, testDatabase, type ApiCall } from '../test/fakeApi';
import { renderWithDb, settleSync } from '../test/renderApp';
import { seedBaby } from '../test/seed';
import { ImportBackupSection } from './ImportBackupSection';
import type { BackupKindCountsDto, BackupReportDto } from './backupModel';

let db: BabyRoutineDb;

beforeEach(() => {
  db = testDatabase();
});

afterEach(async () => {
  await settleSync();
  vi.restoreAllMocks();
  await db.delete();
});

const RESTORE_PREVIEW = '/api/v1/babies/import/preview';
const RESTORE = '/api/v1/babies/import';
const MERGE_PREVIEW = `/api/v1/babies/${BABY_ID}/import/backup/preview`;
const MERGE = `/api/v1/babies/${BABY_ID}/import/backup`;
const NEW_BABY = 'baby-restored';

const counts = (overrides: Partial<BackupKindCountsDto>): BackupKindCountsDto => ({
  total: 0,
  new: 0,
  unchanged: 0,
  updated: 0,
  kept: 0,
  invalid: 0,
  ...overrides,
});

function report(overrides: Partial<BackupReportDto> = {}): BackupReportDto {
  return {
    mode: 'restore',
    applied: false,
    canImport: true,
    babyId: NEW_BABY,
    babyExists: false,
    source: {
      exportedAt: '2026-10-20T12:00:00Z',
      schemaVersion: 1,
      appVersion: '1.0.0',
      babyName: 'Lia',
      birthDate: '2026-08-01',
    },
    kinds: {
      medications: counts({ total: 2, new: 2 }),
      events: counts({ total: 120, new: 100, unchanged: 15, kept: 5 }),
    },
    issues: [],
    issueCount: 0,
    notices: [{ code: 'authors_remapped', count: 7 }],
    ...overrides,
  };
}

/** Answers like the server: a preview reports, an import applies. */
function handler(preview: BackupReportDto = report()) {
  return (call: ApiCall): unknown => {
    if (call.path === RESTORE_PREVIEW) return preview;
    if (call.path === MERGE_PREVIEW) return { ...preview, mode: 'merge', babyId: BABY_ID };
    if (call.path === RESTORE) return { ...preview, applied: true };
    if (call.path === MERGE) return { ...preview, mode: 'merge', babyId: BABY_ID, applied: true };
    return undefined;
  };
}

function Host() {
  const { babies, baby } = useSelectedBaby();
  return babies ? <ImportBackupSection baby={baby} /> : null;
}

async function setup(run: (call: ApiCall) => unknown = handler(), role: BabyRole | null = 'Owner') {
  if (role) await seedBaby(db, { role });
  const fake = fakeApi(run);
  renderWithDb(db, <Host />, { api: fake.api });
  return fake;
}

const backupFile = (name = 'lotties-backup-lia.json', size = 40) =>
  new File(['{"format":"lotties-backup"}'.padEnd(size, ' ')], name, { type: 'application/json' });

async function pick(file: File) {
  const input = (await screen.findByLabelText(/Choose backup file/)) as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });
}

const preview = (calls: ApiCall[], path: string) => calls.filter((call) => call.path === path);

describe('Import backup', () => {
  it('explains the privacy of the file and that a second import changes nothing', async () => {
    await setup();
    expect(await screen.findByText(/holds your child.s health data/)).toBeTruthy();
    expect(screen.getByText(/Importing the same file again changes nothing/)).toBeTruthy();
  });

  it('previews a file into a new baby, then imports it on confirmation', async () => {
    const { calls, writes } = await setup();
    await pick(backupFile());

    expect(await screen.findByText('This is a preview: nothing has been saved yet.')).toBeTruthy();
    const sent = preview(calls, RESTORE_PREVIEW)[0];
    expect(sent).toMatchObject({ method: 'POST', contentType: 'application/json' });
    expect(sent.rawBody).toBeInstanceOf(Blob);
    // The counts per kind, what is zero left out.
    expect(screen.getByText('Medications')).toBeTruthy();
    expect(screen.getByText('2 new')).toBeTruthy();
    expect(screen.getByText('100 new, 15 already there, 5 kept as they are')).toBeTruthy();
    expect(screen.getByText(/Entries written by other people \(7\)/)).toBeTruthy();
    // Nothing was written until the person confirms.
    expect(writes().filter((call) => call.path === RESTORE)).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: 'Import into a new baby' }));

    expect(await screen.findByText(/The baby was created/)).toBeTruthy();
    expect(preview(calls, RESTORE)).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Open the app' }).getAttribute('href')).toBe('/');
  });

  it('adds to the selected baby when asked, with its own preview and import', async () => {
    const { calls } = await setup();
    await pick(backupFile());
    await screen.findByText('This is a preview: nothing has been saved yet.');

    fireEvent.click(screen.getByRole('radio', { name: 'Add to Lia' }));
    await waitFor(() => expect(preview(calls, MERGE_PREVIEW)).toHaveLength(1));
    expect(screen.getByText(/Nothing is deleted, and where both have the same entry/)).toBeTruthy();

    fireEvent.click(await screen.findByRole('button', { name: 'Add to Lia' }));
    expect(await screen.findByText(/The missing data was added/)).toBeTruthy();
    expect(preview(calls, MERGE)).toHaveLength(1);
    expect(preview(calls, RESTORE)).toHaveLength(0);
  });

  it('offers only a new baby to someone who cannot write to the selected one', async () => {
    await setup(handler(), 'Viewer');
    await screen.findByText(/Choose backup file/);
    expect(screen.queryByRole('radio')).toBeNull();
    expect(screen.getByText(/Creates a new baby with everything in the file/)).toBeTruthy();
  });

  it('works for an account with no baby yet', async () => {
    const { calls } = await setup(handler(), null);
    await pick(backupFile());

    await screen.findByText('This is a preview: nothing has been saved yet.');
    expect(preview(calls, RESTORE_PREVIEW)).toHaveLength(1);
  });

  it('lists the invalid records and will not import them', async () => {
    const invalid = report({
      canImport: false,
      issueCount: 3,
      issues: [
        { kind: 'events', id: 'e-1', code: 'event_type_not_available' },
        { kind: 'measurements', id: 'm-1', code: 'validation_failed', field: 'WeightKg' },
      ],
      kinds: { events: counts({ total: 2, new: 1, invalid: 1 }) },
    });
    const { calls } = await setup(handler(invalid));
    await pick(backupFile());

    expect(await screen.findByText(/Some records in this file are not valid/)).toBeTruthy();
    expect(screen.getByText('3 records are not valid:')).toBeTruthy();
    expect(screen.getByText(/Events: This event type is not available for this baby/)).toBeTruthy();
    expect(screen.getByText('And 1 more.')).toBeTruthy();
    const button = screen.getByRole('button', {
      name: 'Import into a new baby',
    }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(preview(calls, RESTORE)).toHaveLength(0);
  });

  it('says so when the file is already in the baby, and offers nothing to confirm', async () => {
    const same = report({
      babyExists: true,
      kinds: { events: counts({ total: 5, unchanged: 5 }) },
      notices: [],
    });
    await setup(handler(same));
    await pick(backupFile());

    expect(await screen.findByText(/everything in this file is already there/)).toBeTruthy();
    expect(screen.getByText(/You already restored this file into a baby of yours/)).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: 'Import into a new baby' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it('explains a file from a newer app version', async () => {
    await setup((call) => {
      if (call.path === RESTORE_PREVIEW) {
        throw new ApiError(422, {
          code: 'backup_unsupported_version',
          schemaVersion: 2,
          maxSupported: 1,
        });
      }
      return undefined;
    });
    await pick(backupFile());

    expect(await screen.findByText(/newer version of the app \(file version 2/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Import into a new baby' })).toBeNull();
  });

  it('explains a damaged file', async () => {
    await setup((call) => {
      if (call.path === RESTORE_PREVIEW)
        throw new ApiError(422, { code: 'backup_checksum_mismatch' });
      return undefined;
    });
    await pick(backupFile());

    expect(await screen.findByText(/changed or damaged after it was exported/)).toBeTruthy();
  });

  it('refuses a file that is too large before sending it', async () => {
    const { calls } = await setup();
    await pick(backupFile('big.json', 7 * 1024 * 1024));

    expect(await screen.findByText(/too large to upload \(up to 6 MB\)/)).toBeTruthy();
    expect(preview(calls, RESTORE_PREVIEW)).toHaveLength(0);
  });

  it('keeps the file for another try when the import itself fails', async () => {
    const { calls } = await setup((call) => {
      if (call.path === RESTORE) throw new ApiError(422, { code: 'backup_rejected' });
      return handler()(call);
    });
    await pick(backupFile());
    fireEvent.click(await screen.findByRole('button', { name: 'Import into a new baby' }));

    expect(await screen.findByText(/Some records of the backup are not valid/)).toBeTruthy();
    expect(preview(calls, RESTORE)).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Import into a new baby' })).toBeTruthy();
  });
});
