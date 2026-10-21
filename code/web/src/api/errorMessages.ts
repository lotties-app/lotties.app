import { EventCommandError } from '../db/errors';
import { InvalidMedicationError } from '../db/medicationCommands';
import { renderCatalogText } from '../i18n/catalog';
import { t } from '../i18n/i18n';
import { ApiError } from './ApiError';
import { getOwn } from '../util/ownProperty';

/** Per-screen wording for a problem `code`, evaluated when the message is built. */
export type ErrorOverrides = Record<string, () => string>;

export const offlineMessage = () => t('errors.offline');

const LOCAL_ERRORS = {
  EventNotFoundError: () => t('errors.local.eventNotFound'),
  EventDeletedError: () => t('errors.local.eventDeleted'),
  EventAlreadyStoppedError: () => t('errors.local.eventNotRunning'),
  InvalidEventTimeRangeError: () => t('errors.local.invalidTimeRange'),
} satisfies Record<string, () => string>;

/** Wording for failures raised by local (Dexie) commands; `null` when the error is not one. */
function describeLocalError(error: unknown): string | null {
  if (error instanceof EventCommandError) {
    return getOwn(LOCAL_ERRORS, error.name)?.() ?? t('errors.generic');
  }
  if (error instanceof InvalidMedicationError) {
    return error.code === 'gone'
      ? t('errors.local.medicationGone')
      : t('errors.local.medicationNameRequired');
  }
  return null;
}

/**
 * A user-facing sentence for a failed operation: the API problem `code` (catalog `errors.<code>`),
 * then the HTTP status, then network and local failures. Server `detail` text is never shown.
 */
export function describeApiError(error: unknown, overrides: ErrorOverrides = {}): string {
  if (error instanceof ApiError) {
    const override = error.code ? getOwn(overrides, error.code) : undefined;
    if (override) return override();
    const known = error.code
      ? renderCatalogText(['errors', error.code], { ...error.problem })
      : undefined;
    if (known) return known;
    if (error.status === 429) return t('errors.tooManyRequests');
    if (error.status === 413) return t('errors.tooLarge');
    if (error.status === 403) return t('errors.forbidden');
    return t('errors.serverUnavailable');
  }
  if (error instanceof TypeError) return offlineMessage();
  return describeLocalError(error) ?? t('errors.generic');
}
