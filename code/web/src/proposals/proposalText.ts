import type { PrescriptionContent } from '../db/models';
import { t } from '../i18n/i18n';
import { dayText } from '../medications/prescriptionForm';

/** "From 22 Oct 2026 to 5 Nov 2026", or "From 22 Oct 2026, no end date". */
export function courseText(content: Pick<PrescriptionContent, 'startDate' | 'endDate'>): string {
  const start = dayText(content.startDate);
  return content.endDate
    ? t('proposals.facts.courseRange', { start, end: dayText(content.endDate) })
    : t('proposals.facts.courseOpen', { start });
}
