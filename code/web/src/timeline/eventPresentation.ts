import type {
  BabyEvent,
  EventType,
  Medication,
  MedicationEventPayload,
  Prescription,
} from '../db/models';
import { optionIcon } from '../events/optionIcons';
import { eventTypeText, type EventTypeText } from '../i18n/eventTypeText';
import { t } from '../i18n/i18n';
import { isMedicationType } from '../events/formModel';
import { typeCategory, typeIcon } from '../now/typeVisual';
import type { CategoryName } from '../theme/tokens';
import type { IconName } from '../ui/icons';
import { getOwn } from '../util/ownProperty';
import { medicationNames, payloadParts } from './payloadSummary';
import { formatNumber, formatMetricUnit } from '../i18n/format';

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

/** Dose, the prescription it followed and whether it was logged early, per medication entry. */
function medicationDetail(event: BabyEvent, prescriptions: readonly Prescription[]): string {
  const list = (event.payload as Partial<MedicationEventPayload>).medications;
  return (Array.isArray(list) ? list : [])
    .flatMap((m) => {
      const prescription = m.prescriptionId
        ? prescriptions.find((p) => p.id === m.prescriptionId)
        : undefined;
      return [
        m.dose ? `${formatNumber(m.dose.amount)} ${m.dose.unit}` : null,
        m.kgUsed !== undefined
          ? t('medications.day.kgUsed', { kg: formatMetricUnit(m.kgUsed, 'kilogram') })
          : null,
        m.prescriptionId
          ? prescription?.indication
            ? t('medications.day.byPrescriptionFor', { indication: prescription.indication })
            : t('medications.day.byPrescription')
          : null,
        m.override === true ? t('medications.day.early') : null,
      ];
    })
    .filter((part): part is string => part !== null)
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
  prescriptions: readonly Prescription[] = [],
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
      detail: medicationDetail(event, prescriptions),
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
