import type { BabyEvent, EventType, Medication, MedicationEventPayload } from '../db/models';
import { optionIcon } from '../events/optionIcons';
import { eventTypeText, type EventTypeText } from '../i18n/eventTypeText';
import { t } from '../i18n/i18n';
import { isMedicationType } from '../events/formModel';
import { typeCategory, typeIcon } from '../now/typeVisual';
import type { CategoryName } from '../theme/tokens';
import type { IconName } from '../ui/icons';
import { getOwn } from '../util/ownProperty';
import { medicationNames, payloadParts } from './payloadSummary';
import { formatNumber } from '../i18n/format';

/** The field whose option names the event on a Day row (`Nap`, `Bottle`, `Wet`). */
const TITLE_FIELD: ReadonlyMap<string, string> = new Map([
  ['sleep', 'kind'],
  ['feeding', 'method'],
  ['diaper', 'content'],
]);

export interface EventPresentation {
  title: string;
  icon: IconName;
  category: CategoryName;
  /** Muted second line (`60 ml · Formula`); empty when there is nothing more to say. */
  detail: string;
}

const SEPARATOR = ' · ';

function medicationDetail(event: BabyEvent): string {
  const list = (event.payload as Partial<MedicationEventPayload>).medications;
  return (Array.isArray(list) ? list : [])
    .filter((m) => m.dose)
    .map((m) => `${formatNumber(m.dose!.amount)} ${m.dose!.unit}`)
    .join(SEPARATOR);
}

/**
 * How an event reads on the Day timeline: a title derived from the event (sleep kinds, feeding
 * method, diaper content, medication names), the icon and category that go with it, and the rest
 * of the payload as a localized detail line. Raw codes never reach the text: options go through the
 * catalogs and unknown ones are humanized.
 */
export function presentEvent(
  event: BabyEvent,
  type: EventType | undefined,
  medications: Medication[] = [],
  text: EventTypeText = eventTypeText,
): EventPresentation {
  const base = {
    icon: typeIcon(type),
    category: typeCategory(type),
  };
  const typeName = type ? text.typeName(type) : t('common.event');
  if (isMedicationType(type)) {
    const names = medicationNames(event.payload, medications);
    return {
      ...base,
      title: names.length > 0 ? names.join(', ') : typeName,
      detail: medicationDetail(event),
    };
  }
  const titleKey = type && type.babyId === null ? TITLE_FIELD.get(type.key) : undefined;
  const raw = titleKey ? getOwn(event.payload, titleKey) : undefined;
  const parts = payloadParts(event.payload, type, text);
  if (!type || !titleKey || typeof raw !== 'string' || raw === '') {
    return { ...base, title: typeName, detail: parts.map((p) => p.text).join(SEPARATOR) };
  }
  const field = { key: titleKey };
  const icon = optionIcon(type, field, raw) ?? base.icon;
  const category: CategoryName =
    type.key === 'sleep' && raw === 'night_waking' ? 'nightWaking' : base.category;
  return {
    icon,
    category,
    title: text.optionLabel(type, field, raw),
    detail: parts
      .filter((p) => p.key !== titleKey)
      .map((p) => p.text)
      .join(SEPARATOR),
  };
}
