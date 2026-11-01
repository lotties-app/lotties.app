import { Blob as NodeBlob } from 'node:buffer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/ApiError';
import {
  MAX_UPLOAD_BYTES,
  backupFileName,
  changesNothing,
  describeBackupError,
  describeCounts,
  describeIssueCode,
  describeNotice,
  isGzip,
  prepareUpload,
  type BackupReportDto,
} from './backupModel';

afterEach(() => vi.unstubAllGlobals());

const counts = (overrides: Partial<BackupReportDto['kinds'][string]> = {}) => ({
  total: 0,
  new: 0,
  unchanged: 0,
  updated: 0,
  kept: 0,
  invalid: 0,
  ...overrides,
});

describe('backupFileName', () => {
  it('names the file after the baby and the date, in plain letters', () => {
    const now = new Date(2026, 9, 3);
    expect(backupFileName('Lia', now, true)).toBe('lotties-backup-lia-20261003.json.gz');
    expect(backupFileName('  Maria Clara-Ação  ', now, false)).toBe(
      'lotties-backup-maria-clara-acao-20261003.json',
    );
    expect(backupFileName('!!!', now, true)).toBe('lotties-backup-20261003.json.gz');
    expect(backupFileName('x'.repeat(80), now, false)).toBe(
      `lotties-backup-${'x'.repeat(40)}-20261003.json`,
    );
  });
});

describe('prepareUpload', () => {
  it('sends a .json.gz as it is', async () => {
    const gz = new Blob([new Uint8Array([0x1f, 0x8b, 8, 0, 1, 2, 3])]);
    expect(await isGzip(gz)).toBe(true);
    const upload = await prepareUpload(gz);
    expect(upload?.body).toBe(gz);
    expect(upload?.contentType).toBe('application/gzip');
  });

  it('sends a small .json as it is, and compresses a big one when the browser can', async () => {
    const small = new Blob(['{"format":"lotties-backup"}']);
    expect((await prepareUpload(small))?.contentType).toBe('application/json');

    // jsdom's Blob cannot stream: a Node one stands in for the browser's, and the codec passes bytes through.
    class PassThrough {
      constructor() {
        return new TransformStream();
      }
    }
    vi.stubGlobal('CompressionStream', PassThrough);
    const big = new NodeBlob(['x'.repeat(100_000)]) as unknown as Blob;
    const upload = await prepareUpload(big);
    expect(upload?.contentType).toBe('application/gzip');
    expect(upload?.body).not.toBe(big);
    expect(upload?.body.size).toBe(100_000);
  });

  it('refuses a file that stays over the upload limit', async () => {
    const huge = {
      size: MAX_UPLOAD_BYTES + 1,
      slice: () => new Blob([new Uint8Array([0x1f, 0x8b])]),
    };
    expect(await prepareUpload(huge as unknown as Blob)).toBeNull();
  });
});

describe('describing a report', () => {
  it('lists only the counts that are not zero', () => {
    expect(describeCounts(counts({ total: 7, new: 5, unchanged: 2 }))).toBe(
      '5 new, 2 already there',
    );
    expect(describeCounts(counts({ total: 4, updated: 1, kept: 2, invalid: 1 }))).toBe(
      '1 updated, 2 kept as they are, 1 not valid',
    );
  });

  it('knows when an import would change nothing', () => {
    const report = (kinds: BackupReportDto['kinds']) => ({ kinds }) as BackupReportDto;
    expect(changesNothing(report({ events: counts({ total: 3, unchanged: 2, kept: 1 }) }))).toBe(
      true,
    );
    expect(changesNothing(report({ events: counts({ total: 3, new: 1 }) }))).toBe(false);
    expect(changesNothing(report({ events: counts({ total: 3, updated: 1 }) }))).toBe(false);
  });

  it('words notices and issue codes, and falls back to the code', () => {
    expect(describeNotice('authors_remapped', 3)).toContain('3');
    expect(describeNotice('something_new', 1)).toBe('something_new');
    expect(describeIssueCode('validation_failed')).toBe('Some details are missing or not valid.');
    expect(describeIssueCode('made_up_code')).toBe('made_up_code');
  });
});

describe('describeBackupError', () => {
  const problem = (status: number, code?: string, extra: object = {}) =>
    new ApiError(status, { status, ...(code ? { code } : {}), ...extra });

  it('uses the catalog text of the problem code', () => {
    expect(
      describeBackupError(
        problem(422, 'backup_unsupported_version', { schemaVersion: 3, maxSupported: 1 }),
      ),
    ).toContain('version 3');
    expect(describeBackupError(problem(422, 'backup_checksum_mismatch'))).toContain(
      'changed or damaged',
    );
    expect(describeBackupError(problem(400, 'backup_invalid_file'))).toContain('not a backup file');
  });

  it('explains an oversize upload with the limit', () => {
    expect(describeBackupError(problem(413))).toContain('6 MB');
  });

  it('says the user is offline for a network failure', () => {
    expect(describeBackupError(new TypeError('Failed to fetch'))).toContain('offline');
  });
});
