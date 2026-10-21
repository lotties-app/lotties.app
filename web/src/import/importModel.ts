import { ApiError } from '../api/ApiError';
import { describeApiError } from '../api/errorMessages';
import { formatDate, formatNumber } from '../i18n/format';
import { t } from '../i18n/i18n';
import type {
  MedicationMapping,
  MedicationSuggestion,
  NapperImportRequest,
  NapperSummaryBase,
} from '../sync/contract';
import { getOwn, setOwn } from '../util/ownProperty';

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
    ? t('import.files.tooBigLocal', { name: file.name, limit: MAX_IMPORT_LABEL })
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
  for (const s of suggestions) {
    if (getOwn(merged, s.token) === undefined) setOwn(merged, s.token, choiceFromSuggestion(s));
  }
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
    if (choice.action === 'create' && !choice.name.trim())
      setOwn(problems, token, t('import.medications.enterName'));
    else if (choice.action === 'create' && choice.name.trim().length > 100) {
      setOwn(problems, token, t('import.medications.tooLong'));
    } else if (choice.action === 'existing' && !choice.medicationId) {
      setOwn(problems, token, t('import.medications.pickOne'));
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
  const from = formatDate(summary.from);
  const to = formatDate(summary.to);
  return from === to ? from : t('import.preview.dateRange', { from, to });
}

const mb = (bytes: number) => `${formatNumber(Math.round((bytes / (1024 * 1024)) * 10) / 10)} MB`;

/** Friendly sentence for a failed preview or import call (specific codes first). */
export function describeImportError(error: unknown): string {
  if (error instanceof ApiError) {
    const p = error.problem;
    if (error.status === 413 || error.code === 'import_file_too_large') {
      const limit = p?.maxBytes ? mb(p.maxBytes) : MAX_IMPORT_LABEL;
      return t('import.errors.tooLargeServer', { limit });
    }
    switch (error.code) {
      case 'import_too_many_rows':
        return t('import.errors.tooManyRows', { max: formatNumber(p?.maxRows ?? 20000) });
      case 'import_invalid_file':
        return t('import.errors.invalidFile', {
          field: p?.field ?? t('import.errors.invalidFileDefault'),
        });
      case 'import_unmapped_medications':
        return t('import.errors.unmapped', {
          names: (p?.tokens ?? []).join(', ') || t('import.errors.unmappedDefault'),
        });
      case 'import_invalid_medication_mapping':
        return t('import.errors.invalidMapping', {
          token: p?.token ?? t('import.errors.invalidMappingDefault'),
        });
      case 'import_conflict':
        return t('import.errors.conflict');
      case 'validation_failed':
        return t('import.errors.validationFailed');
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
