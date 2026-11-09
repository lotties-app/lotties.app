import type { TFunction } from 'i18next';
import { formatTime } from '../i18n/format';
import type { RestPart } from './restApi';

/** One part as approximate times, with its notes (also used by the history table). */
export function partText(part: RestPart, t: TFunction): string {
  const start = formatTime(part.start);
  const main = part.end
    ? t('rest.part.range', { start, end: formatTime(part.end) })
    : t('rest.part.ongoing', { start });
  const notes = [
    part.endSource === 'confirmed' ? t('rest.part.confirmed') : null,
    part.confidence === 'low' ? t('rest.part.lowConfidence') : null,
  ].filter(Boolean);
  return notes.length > 0 ? `${main} (${notes.join(', ')})` : main;
}
