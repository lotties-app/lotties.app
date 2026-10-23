import { ApiError } from '../api/ApiError';
import { describeApiError } from '../api/errorMessages';
import { renderCatalogText } from '../i18n/catalog';
import { t } from '../i18n/i18n';

/*
 * Export and import of a baby's data (docs/design/24-export-import.md). The server builds and reads
 * the file; this module holds what the screens need around it: the report types, the upload
 * preparation (gzip), the file name and the wording of failures.
 */

/** The sections of a report, in the order the server lists them. */
export const BACKUP_KINDS = [
  'eventTypes',
  'medications',
  'prescriptions',
  'formulas',
  'careProviders',
  'appointments',
  'vaccinations',
  'measurements',
  'notes',
  'events',
] as const;
export type BackupKind = (typeof BACKUP_KINDS)[number];

export interface BackupKindCountsDto {
  total: number;
  new: number;
  unchanged: number;
  updated: number;
  kept: number;
  invalid: number;
}

export interface BackupIssueDto {
  kind: string;
  id?: string | null;
  code: string;
  message?: string;
  field?: string | null;
}

export interface BackupNoticeDto {
  code: string;
  count: number;
}

/** What an import will do (a preview, `applied` false) or did (`applied` true). */
export interface BackupReportDto {
  mode: 'restore' | 'merge';
  applied: boolean;
  canImport: boolean;
  babyId: string;
  babyExists: boolean;
  source: {
    exportedAt: string;
    schemaVersion: number;
    appVersion?: string | null;
    babyName?: string | null;
    birthDate: string;
  };
  kinds: Record<string, BackupKindCountsDto>;
  issues: BackupIssueDto[];
  issueCount: number;
  notices: BackupNoticeDto[];
}

/** The server accepts uploads up to 6 MiB; a little less keeps the headers and the form clear of it. */
export const MAX_UPLOAD_BYTES = 6 * 1024 * 1024 - 64 * 1024;
export const MAX_UPLOAD_LABEL = '6 MB';

/** The most invalid records the screen lists; the server caps its list lower still. */
export const MAX_ISSUES_SHOWN = 20;

/** Files smaller than this are sent as they are: compressing them gains nothing. */
const COMPRESS_FROM_BYTES = 64 * 1024;

const GZIP_MAGIC = [0x1f, 0x8b];

export async function isGzip(file: Blob): Promise<boolean> {
  const head = new Uint8Array(await file.slice(0, 2).arrayBuffer());
  return head.length === 2 && head[0] === GZIP_MAGIC[0] && head[1] === GZIP_MAGIC[1];
}

export function canCompress(): boolean {
  return typeof CompressionStream !== 'undefined';
}

/** Compresses `file` with the browser's gzip; the file itself when it cannot or need not. */
export async function gzipBlob(file: Blob): Promise<Blob> {
  if (!canCompress() || typeof file.stream !== 'function' || file.size < COMPRESS_FROM_BYTES) {
    return file;
  }
  const compressed = file.stream().pipeThrough(new CompressionStream('gzip'));
  return new Response(compressed).blob();
}

export interface PreparedUpload {
  body: Blob;
  contentType: string;
}

/**
 * What is uploaded for a picked file: a `.json.gz` as it is, a `.json` gzipped when the browser can
 * (so a big baby fits the upload limit). `null` when the result is still too large.
 */
export async function prepareUpload(file: Blob): Promise<PreparedUpload | null> {
  const alreadyGzip = await isGzip(file);
  const body = alreadyGzip ? file : await gzipBlob(file);
  if (body.size > MAX_UPLOAD_BYTES) return null;
  const compressed = alreadyGzip || body !== file;
  return { body, contentType: compressed ? 'application/gzip' : 'application/json' };
}

/** `lotties-backup-<name>-<yyyymmdd>.json[.gz]` with the baby's name reduced to letters and digits. */
export function backupFileName(babyName: string, now: Date, gzip: boolean): string {
  const slug = babyName
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  const stamp = [now.getFullYear(), now.getMonth() + 1, now.getDate()]
    .map((part, index) => String(part).padStart(index === 0 ? 4 : 2, '0'))
    .join('');
  return `lotties-backup${slug ? `-${slug}` : ''}-${stamp}.json${gzip ? '.gz' : ''}`;
}

/** Saves `file` through the browser's download (a link to an object URL, clicked once). */
export function saveBlob(file: Blob, name: string): void {
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.rel = 'noopener';
  link.style.display = 'none';
  document.body.append(link);
  link.click();
  link.remove();
  // The download has started by the time the task ends; revoking later keeps slow browsers safe.
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** A sentence for a failed export, upload, preview or import (the problem `code` first). */
export function describeBackupError(error: unknown): string {
  if (error instanceof ApiError && error.status === 413) {
    return t('backup.errors.tooLarge', { limit: MAX_UPLOAD_LABEL });
  }
  return describeApiError(error);
}

/** The counts of a kind as a short sentence, leaving out what is zero. */
export function describeCounts(counts: BackupKindCountsDto): string {
  const parts: string[] = [];
  if (counts.new > 0) parts.push(t('backup.report.new', { count: counts.new }));
  if (counts.unchanged > 0) parts.push(t('backup.report.unchanged', { count: counts.unchanged }));
  if (counts.updated > 0) parts.push(t('backup.report.updated', { count: counts.updated }));
  if (counts.kept > 0) parts.push(t('backup.report.kept', { count: counts.kept }));
  if (counts.invalid > 0) parts.push(t('backup.report.invalid', { count: counts.invalid }));
  return parts.join(', ');
}

/** What an issue's code means in the user's language; the code itself when the catalog has no text. */
export function describeIssueCode(code: string): string {
  return renderCatalogText(['errors', code], {}) ?? code;
}

/** What a notice of the server says in the user's language; its code when this build does not know it. */
export function describeNotice(code: string, count: number): string {
  return renderCatalogText(['backup', 'notices', code], { count }) ?? code;
}

/** Whether the report adds, changes or removes nothing: the file is already in the baby. */
export function changesNothing(report: BackupReportDto): boolean {
  return Object.values(report.kinds).every((counts) => counts.new === 0 && counts.updated === 0);
}
