import type { Dosage, EventType } from '../db/models';
import { eventTypeText } from '../i18n/eventTypeText';
import { formatDuration, formatNumber, formatTime, formatUnit } from '../i18n/format';
import { t } from '../i18n/i18n';
import { countedAmountText, countedUnitOf } from '../medications/doseUnits';
import type { CategoryName } from '../theme/tokens';
import type { IconName } from '../ui/icons';
import { catchUpName } from './nowText';
import type { CatchUp, CatchUpGroup } from './catchUp';

/*
 * Words for the hand-over card (docs/design/01-ux-strategy.md flow 3): the rows of one person's
 * activity, and the same content as plain text to share with someone who has no app.
 */

export interface CatchUpLine {
  category: CategoryName;
  icon: IconName;
  text: string;
  /** Right-hand detail ("2h total", "11:40"). */
  detail?: string;
}

const MINUTE_MS = 60_000;

/** "2.5 ml", "5 drops", "2 sprays": the dose as logged, with the unit in the active language when known. */
export function doseText(dose: Dosage): string {
  const counted = countedUnitOf(dose.unit);
  if (counted) return countedAmountText(dose.amount, counted);
  const unit =
    dose.unit === 'drops' || dose.unit === 'ml' || dose.unit === 'mg'
      ? t(`ui.units.${dose.unit}`)
      : dose.unit;
  return `${formatNumber(dose.amount)} ${unit}`;
}

function diaperDetail(diapers: CatchUpGroup['diapers']): string | undefined {
  const parts = [
    diapers.wet > 0 ? t('now.catchUp.wet', { count: diapers.wet }) : '',
    diapers.dirty > 0 ? t('now.catchUp.dirty', { count: diapers.dirty }) : '',
    diapers.mixed > 0 ? t('now.catchUp.mixed', { count: diapers.mixed }) : '',
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : undefined;
}

/** What one person logged, one line per kind of activity. */
export function catchUpLines(group: CatchUpGroup, types: readonly EventType[]): CatchUpLine[] {
  const lines: CatchUpLine[] = [];
  const { sleep, feeds, diapers } = group;
  if (sleep.count > 0) {
    lines.push({
      category: 'sleep',
      icon: 'moon',
      text: t('now.catchUp.sleeps', { count: sleep.count }),
      detail: t('now.catchUp.total', { duration: formatDuration(sleep.totalMinutes * MINUTE_MS) }),
    });
  }
  if (sleep.nightWakings > 0) {
    lines.push({
      category: 'nightWaking',
      icon: 'eye',
      text: t('now.catchUp.nightWakings', { count: sleep.nightWakings }),
    });
  }
  if (feeds.count > 0) {
    const detail = [
      feeds.totalMl > 0 ? formatUnit(feeds.totalMl, 'milliliter') : '',
      feeds.lastAt ? t('now.catchUp.last', { time: formatTime(feeds.lastAt) }) : '',
    ]
      .filter(Boolean)
      .join(' · ');
    lines.push({
      category: 'feeding',
      icon: 'bottle',
      text: t('now.catchUp.feeds', { count: feeds.count }),
      ...(detail ? { detail } : {}),
    });
  }
  if (diapers.count > 0) {
    const detail = diaperDetail(diapers);
    lines.push({
      category: 'diaper',
      icon: 'diaper',
      text: t('now.catchUp.diapers', { count: diapers.count }),
      ...(detail ? { detail } : {}),
    });
  }
  for (const medication of group.medications) {
    const next = medication.nextAllowedAt
      ? t('now.catchUp.nextFrom', { time: formatTime(medication.nextAllowedAt) })
      : '';
    lines.push({
      category: 'health',
      icon: 'pill',
      text: medication.dose ? `${medication.name} ${doseText(medication.dose)}` : medication.name,
      detail: [formatTime(medication.at), next].filter(Boolean).join(' · '),
    });
  }
  for (const other of group.other) {
    const type = types.find((candidate) => candidate.id === other.typeId);
    lines.push({
      category: 'custom',
      icon: 'event',
      text: type ? eventTypeText.typeName(type) : t('common.event'),
      detail: t('now.catchUp.times', { count: other.count }),
    });
  }
  return lines;
}

/** "Vini logged 9 things since 08:10". */
export function catchUpSummary(group: CatchUpGroup, since: string): string {
  return t('now.catchUp.logged', {
    name: catchUpName(group),
    count: group.count,
    time: formatTime(since),
  });
}

/** The hand-over as plain text for a messenger: one line per person. */
export function catchUpShareText(
  catchUp: CatchUp,
  babyName: string,
  types: readonly EventType[],
): string {
  const lines = catchUp.groups.map((group) => {
    const parts = catchUpLines(group, types).map((line) =>
      line.detail ? `${line.text} (${line.detail})` : line.text,
    );
    return `${catchUpName(group)}: ${parts.join(', ')}`;
  });
  return [
    t('now.catchUp.shareHeader', { name: babyName, time: formatTime(catchUp.since) }),
    ...lines,
  ].join('\n');
}
