import type { BackupReportDto } from '../backup/backupModel';
import { apiPaths } from '../sync/contract';
import type { ApiClient } from './apiClient';

/*
 * Export and import of a baby's data (docs/design/24-export-import.md). Online-only server calls:
 * the file is built and read on the server, which is the source of truth. Failures throw
 * `ApiError` / network `TypeError`.
 */

/** Where an imported file goes: a new baby of the caller, or an existing baby she may write to. */
export type BackupTarget = { kind: 'restore' } | { kind: 'merge'; babyId: string };

/** The baby's backup file, as the server writes it (`.json.gz` when `compress`). */
export function exportBackup(api: ApiClient, babyId: string, compress: boolean): Promise<Blob> {
  return api.request<Blob>(apiPaths.backupExport(babyId, compress), { responseType: 'blob' });
}

function importPath(target: BackupTarget, preview: boolean): string {
  if (target.kind === 'restore') {
    return preview ? apiPaths.backupRestorePreview() : apiPaths.backupRestore();
  }
  return preview ? apiPaths.backupMergePreview(target.babyId) : apiPaths.backupMerge(target.babyId);
}

/** What importing the file would do. Writes nothing. */
export function previewBackup(
  api: ApiClient,
  target: BackupTarget,
  file: Blob,
  contentType: string,
): Promise<BackupReportDto> {
  return api.request<BackupReportDto>(importPath(target, true), {
    method: 'POST',
    rawBody: file,
    contentType,
  });
}

/** Imports the file; the server refuses it (422 `backup_rejected`) while any record is invalid. */
export function importBackup(
  api: ApiClient,
  target: BackupTarget,
  file: Blob,
  contentType: string,
): Promise<BackupReportDto> {
  return api.request<BackupReportDto>(importPath(target, false), {
    method: 'POST',
    rawBody: file,
    contentType,
  });
}
