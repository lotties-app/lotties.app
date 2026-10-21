import { ApiError } from '../api/ApiError';
import { describeApiError } from '../api/errorMessages';
import type {
  MedicationMapping,
  MedicationSuggestion,
  NapperImportRequest,
  NapperSummaryBase,
} from '../sync/contract';

export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
export const MAX_IMPORT_LABEL = '5 MB';

export type FileKind = 'logs' | 'measurements';

export interface PickedFile {
  name: string;
  /** Bytes. */
  size: number;
  text: string;
}

export type PickedFiles = Partial<Record<FileKind, PickedFile>>;

export type MappingChoice =
  | { action: 'existing'; medicationId: string }
  | { action: 'create'; name: string }
  | { action: 'ignore' };

/** The user's decision per medication token. */
export type Choices = Record<string, MappingChoice>;

/** A message when the file cannot be accepted, else `null`. */
export function checkFileSize(file: { name: string; size: number }): string | null {
  return file.size > MAX_IMPORT_BYTES
    ? `${file.name} is larger than ${MAX_IMPORT_LABEL}. Export a smaller range and try again.`
    : null;
}

export function choiceFromSuggestion(s: MedicationSuggestion): MappingChoice {
  if (s.suggestion === 'existing' && s.medicationId) {
    return { action: 'existing', medicationId: s.medicationId };
  }
  return { action: 'create', name: s.medicationName || s.token };
}

/** Adds a prefilled choice for every suggestion the user has not decided on yet. */
export function mergeChoices(current: Choices, suggestions: MedicationSuggestion[]): Choices {
  const merged = { ...current };
  for (const s of suggestions) merged[s.token] ??= choiceFromSuggestion(s);
  return merged;
}

export function toMappings(choices: Choices): MedicationMapping[] {
  return Object.entries(choices).map(([token, choice]) => {
    switch (choice.action) {
      case 'existing':
        return { token, action: 'existing', medicationId: choice.medicationId };
      case 'create':
        return { token, action: 'create', name: choice.name.trim() };
      case 'ignore':
        return { token, action: 'ignore' };
    }
  });
}

/** Identifies the mappings a preview was checked with. */
export function mappingsKey(choices: Choices): string {
  return JSON.stringify(toMappings(choices).sort((a, b) => a.token.localeCompare(b.token)));
}

/** Per-token problems that would make the server reject the mappings. */
export function choiceProblems(choices: Choices): Record<string, string> {
  const problems: Record<string, string> = {};
  for (const [token, choice] of Object.entries(choices)) {
    if (choice.action === 'create' && !choice.name.trim()) problems[token] = 'Enter a name.';
    else if (choice.action === 'create' && choice.name.trim().length > 100) {
      problems[token] = 'Use at most 100 characters.';
    } else if (choice.action === 'existing' && !choice.medicationId) {
      problems[token] = 'Pick a medication.';
    }
  }
  return problems;
}

export function buildRequest(files: PickedFiles, choices: Choices): NapperImportRequest {
  const mappings = toMappings(choices);
  return {
    ...(files.logs ? { logsCsv: files.logs.text } : {}),
    ...(files.measurements ? { measurementsCsv: files.measurements.text } : {}),
    ...(mappings.length > 0 ? { medicationMappings: mappings } : {}),
  };
}

export function summaryRange(summary: NapperSummaryBase): string | null {
  if (!summary.from || !summary.to) return null;
  const fmt = (iso: string) =>
    new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso).toLocaleDateString(undefined, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: iso.length === 10 ? 'UTC' : undefined,
    });
  const from = fmt(summary.from);
  const to = fmt(summary.to);
  return from === to ? from : `${from} to ${to}`;
}

const mb = (bytes: number) => `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`;

/** Friendly sentence for a failed preview or import call (specific codes first). */
export function describeImportError(error: unknown): string {
  if (error instanceof ApiError) {
    const p = error.problem;
    if (error.status === 413 || error.code === 'import_file_too_large') {
      const limit = p?.maxBytes ? mb(p.maxBytes) : MAX_IMPORT_LABEL;
      return `A file is too large for the server (limit ${limit}). Export a smaller range.`;
    }
    switch (error.code) {
      case 'import_too_many_rows':
        return `A file has too many rows (limit ${p?.maxRows ?? 20000}). Split it and import the parts one by one.`;
      case 'import_invalid_file':
        return `The ${p?.field ?? 'selected'} file is not a valid Napper export (empty, damaged or missing columns).`;
      case 'import_unmapped_medications':
        return `Some medication names still need a decision: ${(p?.tokens ?? []).join(', ') || 'see the list'}.`;
      case 'import_invalid_medication_mapping':
        return `The medication choice for "${p?.token ?? 'a name'}" is not valid. Pick an existing medication or enter a name.`;
      case 'import_conflict':
        return 'Another import or sync wrote the same records at the same time. Nothing was saved; try again.';
      case 'validation_failed':
        return 'The server rejected the request. Check the files and the medication names (up to 100 characters).';
    }
  }
  return describeApiError(error);
}

/** Codes that mean "go back to the medication step". */
export function isMappingError(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    (error.code === 'import_unmapped_medications' ||
      error.code === 'import_invalid_medication_mapping')
  );
}
