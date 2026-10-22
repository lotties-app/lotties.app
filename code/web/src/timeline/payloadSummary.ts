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
import { PAUSE_KEYS, SEGMENT_START_KEY } from '../timers/pauseMath';
import { FORMULA_NAME_KEY } from '../formulas/formulaModel';

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
  // A bottle's formula, as named when it was logged (renames and archiving keep the history).
  if (type.babyId === null && type.key === 'feeding' && field.key === FORMULA_NAME_KEY) {
    return typeof raw === 'string' && raw.trim() !== '' ? raw : null;
  }
  // Forms never show hidden fields (pause keys, deprecated ones); neither does the detail line.
  if (field.hidden === true) return null;
  const label = text.fieldLabel(type, field);
  if (type.babyId === null && type.key === 'sleep') {
    const sleep = sleepDetailPart(field, raw, text, type);
    if (sleep !== undefined) return sleep;
  }
  if (type.babyId === null && type.key === 'belly_massage') {
    const massage = bellyMassagePart(field, raw);
    if (massage !== undefined) return massage;
  }
  if (type.babyId === null && type.key === 'fussy') {
    const fussy = fussyPart(field, raw);
    if (fussy !== undefined) return fussy;
  }
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

/** The detail line wording of the sleep detail fields (`undefined`: use the generic one). */
function sleepDetailPart(
  field: EventFieldDefinition,
  raw: unknown,
  text: EventTypeText,
  type: EventType,
): string | undefined {
  if (field.key === 'time_to_fall_asleep_minutes' && typeof raw === 'number') {
    return t('timeline.fellAsleepIn', { duration: formatDuration(raw * 60_000) });
  }
  if (field.key === 'mood_on_wake' && typeof raw === 'string') {
    return t('timeline.moodOnWake', { mood: text.optionLabel(type, field, raw).toLowerCase() });
  }
  return undefined;
}

/** Whether a belly massage helped, as words that read alone (`helped`, not a bare `Yes`). */
const MASSAGE_HELPED: ReadonlyMap<string, () => string> = new Map([
  ['yes', () => t('timeline.massageHelped.yes')],
  ['a_little', () => t('timeline.massageHelped.aLittle')],
  ['no', () => t('timeline.massageHelped.no')],
]);

/** The detail line wording of the belly massage fields (`undefined`: use the generic one). */
function bellyMassagePart(field: EventFieldDefinition, raw: unknown): string | undefined {
  if (field.key !== 'helped' || typeof raw !== 'string') return undefined;
  return MASSAGE_HELPED.get(raw)?.();
}

/** What soothed a fussy spell, as words that read alone (`rocking helped`, `nothing helped`). */
const FUSSY_HELPED: ReadonlyMap<string, () => string> = new Map([
  ['feeding', () => t('timeline.fussyHelped.feeding')],
  ['rocking', () => t('timeline.fussyHelped.rocking')],
  ['pacifier', () => t('timeline.fussyHelped.pacifier')],
  ['massage', () => t('timeline.fussyHelped.massage')],
  ['sleep', () => t('timeline.fussyHelped.sleep')],
  ['other', () => t('timeline.fussyHelped.other')],
  ['nothing', () => t('timeline.fussyHelped.nothing')],
]);

/** The detail line wording of the fussy fields (`undefined`: use the generic one). */
function fussyPart(field: EventFieldDefinition, raw: unknown): string | undefined {
  if (field.key !== 'what_helped' || typeof raw !== 'string') return undefined;
  return FUSSY_HELPED.get(raw)?.();
}

/** Keys of the app itself (pause keys, the open nursing segment): never shown as details. */
const INTERNAL_KEYS: ReadonlySet<string> = new Set([...PAUSE_KEYS, SEGMENT_START_KEY]);

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
      .filter(([key]) => !known.has(key) && !INTERNAL_KEYS.has(key))
      .map(([key, raw]) => ({ key, text: extraPart(key, raw) })),
  ];
  return parts
    .filter((p): p is PayloadPart => !!p.text)
    .filter((p) => !isOtherMilestoneWithWords(type, payload, p));
}

/**
 * A milestone of the "other" option described in the parents' own words reads as those words
 * alone (`Waved bye-bye`, not `Other · Waved bye-bye`).
 */
function isOtherMilestoneWithWords(
  type: EventType | undefined,
  payload: EventPayload,
  part: PayloadPart,
): boolean {
  if (type?.babyId !== null || type.key !== 'milestone' || part.key !== 'milestone') return false;
  const custom = getOwn(payload, 'custom');
  return (
    getOwn(payload, 'milestone') === 'other' && typeof custom === 'string' && custom.trim() !== ''
  );
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
