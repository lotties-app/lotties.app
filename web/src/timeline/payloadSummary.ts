import type {
  EventFieldDefinition,
  EventPayload,
  EventType,
  Medication,
  MedicationEventPayload,
} from '../db/models';
import { isMedicationType } from '../events/formModel';
import { eventTypeText, type EventTypeText } from '../i18n/eventTypeText';
import { formatDuration, formatNumber } from '../i18n/format';
import { t } from '../i18n/i18n';
import { getOwn } from '../util/ownProperty';

const SEPARATOR = ' · ';

function humanize(key: string): string {
  const words = key.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2');
  return words.charAt(0).toUpperCase() + words.slice(1).toLowerCase();
}

/** `120 ml`, `Intensity 4/5`, `Left`, `Pacifier` (true bool), or `null` when there is no value. */
function fieldPart(
  type: EventType,
  field: EventFieldDefinition,
  raw: unknown,
  text: EventTypeText,
): string | null {
  if (raw === undefined || raw === null || raw === '') return null;
  const label = text.fieldLabel(type, field);
  if (field.kind === 'bool') return raw === true ? label : null;
  if (field.kind === 'number') {
    if (field.unit === 's' && typeof raw === 'number') return formatDuration(raw * 1000);
    const value = typeof raw === 'number' ? formatNumber(raw) : String(raw);
    if (field.unit) return `${value} ${field.unit === 'C' ? '°C' : field.unit}`;
    return field.max !== null
      ? t('timeline.intensity', { label, value, max: formatNumber(field.max) })
      : t('timeline.labelValue', { label, value });
  }
  return field.kind === 'select' ? text.optionLabel(type, field, String(raw)) : String(raw);
}

/** Simple values the type does not describe (e.g. imported or older payloads). */
function extraPart(key: string, raw: unknown): string | null {
  if (typeof raw === 'string') return raw.trim() || null;
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return t('timeline.labelValue', { label: humanize(key), value: formatNumber(raw) });
  }
  if (raw === true) return humanize(key);
  return null;
}

function medicationSummary(payload: EventPayload, catalog: Medication[]): string {
  return medicationNames(payload, catalog).join(', ');
}

/** A piece of the detail line, with the field it came from (`null` for values the type lacks). */
export interface PayloadPart {
  key: string;
  text: string;
}

/** The localized pieces of a payload, in field order; empty values are left out. */
export function payloadParts(
  payload: EventPayload,
  type: EventType | undefined,
  text: EventTypeText = eventTypeText,
): PayloadPart[] {
  const fields = type?.fields ?? [];
  const known = new Set(fields.map((f) => f.key));
  const parts: { key: string; text: string | null }[] = [
    ...(type
      ? fields.map((f) => ({ key: f.key, text: fieldPart(type, f, getOwn(payload, f.key), text) }))
      : []),
    ...Object.entries(payload)
      .filter(([key]) => !known.has(key))
      .map(([key, raw]) => ({ key, text: extraPart(key, raw) })),
  ];
  return parts.filter((p): p is PayloadPart => !!p.text);
}

/** Names of the logged medications, falling back to the catalog. */
export function medicationNames(payload: EventPayload, catalog: Medication[]): string[] {
  const list = (payload as Partial<MedicationEventPayload>).medications;
  return (Array.isArray(list) ? list : []).map(
    (m) =>
      m.name ||
      catalog.find((c) => c.id === m.medicationId)?.name ||
      t('timeline.unknownMedication'),
  );
}

/**
 * One short line describing an event's payload, e.g. `Bottle · 120 ml`, `Colidis, Puravit`,
 * `Intensity 4/5`, `Dirty`. Empty when there is nothing to show.
 */
export function payloadSummary(
  payload: EventPayload,
  type: EventType | undefined,
  catalog: Medication[] = [],
  text: EventTypeText = eventTypeText,
): string {
  if (isMedicationType(type)) return medicationSummary(payload, catalog);
  return payloadParts(payload, type, text)
    .map((part) => part.text)
    .join(SEPARATOR);
}
