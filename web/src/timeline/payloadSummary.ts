import type {
  EventFieldDefinition,
  EventPayload,
  EventType,
  Medication,
  MedicationEventPayload,
} from '../db/models';
import { isMedicationType } from '../events/formModel';
import { getOwn } from '../util/ownProperty';

const SEPARATOR = ' · ';

function humanize(key: string): string {
  const words = key.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2');
  return words.charAt(0).toUpperCase() + words.slice(1).toLowerCase();
}

/** `120 ml`, `Intensity 4/5`, `left`, `Pacifier` (true bool), or `null` when there is no value. */
function fieldPart(field: EventFieldDefinition, raw: unknown): string | null {
  if (raw === undefined || raw === null || raw === '') return null;
  if (field.kind === 'bool') return raw === true ? field.label : null;
  if (field.kind !== 'number') return String(raw);
  if (field.unit) return `${raw} ${field.unit}`;
  return field.max !== null ? `${field.label} ${raw}/${field.max}` : `${field.label} ${raw}`;
}

/** Simple values the type does not describe (e.g. imported or older payloads). */
function extraPart(key: string, raw: unknown): string | null {
  if (typeof raw === 'string') return raw.trim() || null;
  if (typeof raw === 'number' && Number.isFinite(raw)) return `${humanize(key)} ${raw}`;
  if (raw === true) return humanize(key);
  return null;
}

function medicationSummary(payload: EventPayload, catalog: Medication[]): string {
  const list = (payload as Partial<MedicationEventPayload>).medications;
  const names = (Array.isArray(list) ? list : []).map(
    (m) => m.name || catalog.find((c) => c.id === m.medicationId)?.name || 'Unknown medication',
  );
  return names.join(', ');
}

/**
 * One short line describing an event's payload, e.g. `bottle · 120 ml`, `Colidis, Puravit`,
 * `Intensity 4/5`, `DIRTY`. Empty when there is nothing to show.
 */
export function payloadSummary(
  payload: EventPayload,
  type: EventType | undefined,
  catalog: Medication[] = [],
): string {
  if (isMedicationType(type)) return medicationSummary(payload, catalog);
  const fields = type?.fields ?? [];
  const known = new Set(fields.map((f) => f.key));
  const parts = [
    ...fields.map((f) => fieldPart(f, getOwn(payload, f.key))),
    ...Object.entries(payload)
      .filter(([key]) => !known.has(key))
      .map(([key, raw]) => extraPart(key, raw)),
  ];
  return parts.filter((p): p is string => !!p).join(SEPARATOR);
}
