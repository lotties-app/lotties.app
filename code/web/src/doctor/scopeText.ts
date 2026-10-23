import type { TFunction } from 'i18next';
import { formatList } from '../i18n/format';
import type { DoctorScope } from './scopes';

/** The shared sections as a sentence list ("daily log, growth and notes"). */
export function scopeList(scopes: readonly DoctorScope[], t: TFunction): string {
  return formatList(scopes.map((scope) => t(`doctorDashboard.scopes.names.${scope}`)));
}

/** "Sees: daily log and growth", or that she sees only the name and age. */
export function seesText(scopes: readonly DoctorScope[], t: TFunction): string {
  return scopes.length === 0
    ? t('doctorDashboard.access.seesNothing')
    : t('doctorDashboard.access.sees', { list: scopeList(scopes, t) });
}
