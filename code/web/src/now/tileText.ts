import type { EventType } from '../db/models';
import { eventTypeText } from '../i18n/eventTypeText';
import { formatDuration, formatList, formatTime, formatUnit } from '../i18n/format';
import { t } from '../i18n/i18n';
import { typeForKey } from './eventFacts';
import type { QuickTile } from './quickLog';

/*
 * The second line of a "last and log" tile: what the last event was ("Bottle · 120 ml", "Wet",
 * "Colidis"). Language-aware wrapper over `QuickTile.detail`; the timing line is `formatTileStatus`.
 */

/** "Bottle · 120 ml · 18 min", "Nursing · left"; empty when nothing was logged yet. */
export function tileDetailText(tile: QuickTile, types: readonly EventType[]): string {
  const detail = tile.detail;
  if (!detail) return '';
  switch (detail.kind) {
    case 'feed': {
      const type = typeForKey(types, 'feeding');
      if (!detail.method) return '';
      const method = type
        ? eventTypeText.optionLabel(type, { key: 'method' }, detail.method)
        : detail.method;
      const extra =
        detail.method === 'bottle'
          ? [
              detail.amountMl !== null ? formatUnit(detail.amountMl, 'milliliter') : '',
              detail.bottleMs !== null ? formatDuration(detail.bottleMs) : '',
            ]
              .filter(Boolean)
              .join(' · ')
          : detail.method === 'breast' && detail.side
            ? eventTypeText.optionLabel(
                type ?? { key: 'feeding', babyId: null },
                { key: 'side' },
                detail.side,
              )
            : '';
      return extra ? `${method} · ${extra}` : method;
    }
    case 'diaper': {
      const type = typeForKey(types, 'diaper');
      if (!detail.content) return '';
      return type
        ? eventTypeText.optionLabel(type, { key: 'content' }, detail.content)
        : detail.content;
    }
    case 'meds': {
      if (detail.names.length === 0) return '';
      const names = formatList(detail.names);
      return detail.nextAllowedAt
        ? `${names} · ${t('now.catchUp.nextFrom', { time: formatTime(detail.nextAllowedAt) })}`
        : names;
    }
  }
}
