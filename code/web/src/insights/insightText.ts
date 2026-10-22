import type { TFunction } from 'i18next';
import { formatDate, formatTime } from '../i18n/format';
import type { InsightId } from './catalogue';
import type { FormulaReadiness } from './formulaComparison';
import type { Readiness } from './readiness';

/*
 * Wording of the readiness rows and shared chart text. Keys are spelled out per insight (the
 * catalog keys are typed), and counts go through plural keys in en and pt-BR.
 */

export function insightName(t: TFunction, id: InsightId): string {
  switch (id) {
    case 'sleep':
      return t('insights.names.sleep');
    case 'sleepRhythm':
      return t('insights.names.sleepRhythm');
    case 'feeding':
      return t('insights.names.feeding');
    case 'diapers':
      return t('insights.names.diapers');
  }
}

function startLine(t: TFunction, id: InsightId): string {
  switch (id) {
    case 'sleep':
    case 'sleepRhythm':
      return t('insights.start.sleep');
    case 'feeding':
      return t('insights.start.feeding');
    case 'diapers':
      return t('insights.start.diapers');
  }
}

function moreEventsLine(t: TFunction, id: InsightId, count: number): string {
  switch (id) {
    case 'sleep':
    case 'sleepRhythm':
      return t('insights.moreEvents.sleep', { count });
    case 'feeding':
      return t('insights.moreEvents.feeding', { count });
    case 'diapers':
      return t('insights.moreEvents.diapers', { count });
  }
}

/** The friendly line under a readiness row: what to do, or about how long it will take. */
export function estimateLine(t: TFunction, readiness: Readiness): string {
  switch (readiness.state) {
    case 'unlocked':
      return t('insights.ready');
    case 'start':
      return startLine(t, readiness.id);
    case 'days':
      return t('insights.estimateDays', { count: readiness.daysLeft ?? 1 });
    case 'events':
      return moreEventsLine(t, readiness.id, readiness.eventsLeft ?? 1);
  }
}

/** What a formula still needs before the Formulas card shows it: days of use, then bottles. */
export function formulaEstimateLine(t: TFunction, readiness: FormulaReadiness): string {
  if (readiness.daysLeft > 0) return t('insights.formulas.moreDays', { count: readiness.daysLeft });
  return t('insights.formulas.moreBottles', { count: Math.max(1, readiness.bottlesLeft) });
}

/** "Day 3 of 7" (days with data, capped at the days needed). */
export function progressText(t: TFunction, readiness: Readiness): string {
  return t('insights.progress', {
    done: Math.min(readiness.daysWithData, readiness.daysNeeded),
    total: readiness.daysNeeded,
  });
}

/** Short date of a local day for axes and tables ("21 Oct"). */
export const shortDay = (date: Date) => formatDate(date, 'dayMonth');

/** A clock time from local minutes after midnight ("19:40"). */
export function clockText(minutes: number): string {
  const date = new Date(2000, 0, 1, Math.floor(minutes / 60), minutes % 60);
  return formatTime(date);
}
