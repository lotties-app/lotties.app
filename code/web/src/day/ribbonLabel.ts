import type { TFunction } from 'i18next';
import { formatDuration } from '../i18n/format';
import type { DaySummary } from './dayModel';

const MINUTE_MS = 60_000;

/** The text alternative of the ribbon: sleep total, feeds and diapers. */
export function ribbonLabel(summary: DaySummary, t: TFunction): string {
  const sleep =
    summary.sleepMinutes > 0
      ? t('day.ribbon.sleep', { duration: formatDuration(summary.sleepMinutes * MINUTE_MS) })
      : t('day.ribbon.noSleep');
  return t('day.ribbon.label', {
    sleep,
    feeds: t('now.catchUp.feeds', { count: summary.feeds }),
    diapers: t('now.catchUp.diapers', { count: summary.diapers }),
  });
}
