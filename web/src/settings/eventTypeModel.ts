import type { EventFieldKind, EventType } from '../db/models';
import type { CreateEventTypeRequest, EventFieldRequest, EventTypeRequest } from '../sync/contract';

export const COLOR_PALETTE: readonly string[] = [
  '#e53935',
  '#d81b60',
  '#8e24aa',
  '#5e35b1',
  '#3949ab',
  '#1e88e5',
  '#00897b',
  '#43a047',
  '#fb8c00',
  '#6d4c41',
];

export const FIELD_KINDS: readonly { kind: EventFieldKind; label: string }[] = [
  { kind: 'text', label: 'Text' },
  { kind: 'number', label: 'Number' },
  { kind: 'select', label: 'Choice' },
  { kind: 'bool', label: 'Yes / no' },
];

const MAX_KEY_LENGTH = 40;

/** Lower snake_case slug: accents stripped, other characters collapsed to `_`. */
export function slugify(text: string): string {
  const slug = text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, MAX_KEY_LENGTH)
    .replace(/_+$/g, '');
  return /^[0-9]/.test(slug) ? `n_${slug}` : slug;
}

/** Editable form of a field; numbers and options stay text while typing. */
export interface FieldDraft {
  /** Stable React key. */
  uid: string;
  /** Empty for a new field: derived from the label when the type is saved. */
  key: string;
  label: string;
  kind: EventFieldKind;
  isRequired: boolean;
  /** One option per line (select only). */
  options: string;
  min: string;
  max: string;
  unit: string;
}

export interface EventTypeDraft {
  name: string;
  icon: string;
  color: string;
  hasDuration: boolean;
  fields: FieldDraft[];
}

let counter = 0;
export function newFieldDraft(): FieldDraft {
  counter += 1;
  return {
    uid: `field-${counter}`,
    key: '',
    label: '',
    kind: 'text',
    isRequired: false,
    options: '',
    min: '',
    max: '',
    unit: '',
  };
}

export function emptyDraft(icon: string): EventTypeDraft {
  return { name: '', icon, color: COLOR_PALETTE[5], hasDuration: false, fields: [] };
}

export function draftFromType(type: EventType): EventTypeDraft {
  return {
    name: type.name,
    icon: type.icon,
    color: type.color,
    hasDuration: type.hasDuration,
    fields: type.fields.map((f) => ({
      ...newFieldDraft(),
      key: f.key,
      label: f.label,
      kind: f.kind,
      isRequired: f.isRequired,
      options: f.options.join('\n'),
      min: f.min === null ? '' : String(f.min),
      max: f.max === null ? '' : String(f.max),
      unit: f.unit ?? '',
    })),
  };
}

function parseOptions(text: string): string[] {
  const seen = new Set<string>();
  for (const line of text.split('\n')) {
    const option = line.trim();
    if (option) seen.add(option);
  }
  return [...seen];
}

function parseBound(text: string): number | null {
  if (text.trim() === '') return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : Number.NaN;
}

/** Field keys for a draft: existing ones are kept, new ones come from the label, all unique. */
function resolveKeys(fields: FieldDraft[]): string[] {
  const used = new Set(fields.map((f) => f.key).filter(Boolean));
  const keys: string[] = [];
  for (const field of fields) {
    if (field.key) {
      keys.push(field.key);
      continue;
    }
    const base = slugify(field.label) || 'field';
    let key = base;
    for (let i = 2; used.has(key); i += 1) key = `${base}_${i}`;
    used.add(key);
    keys.push(key);
  }
  return keys;
}

function fieldErrors(field: FieldDraft, position: number): string[] {
  const name = field.label.trim() || `Field ${position}`;
  if (!field.label.trim()) return [`${name} needs a label.`];
  const errors: string[] = [];
  if (field.kind === 'select' && parseOptions(field.options).length < 2) {
    errors.push(`${name} needs at least two options.`);
  }
  if (field.kind === 'number') {
    const min = parseBound(field.min);
    const max = parseBound(field.max);
    if (Number.isNaN(min) || Number.isNaN(max))
      errors.push(`${name}: min and max must be numbers.`);
    else if (min !== null && max !== null && min > max) {
      errors.push(`${name}: min must not be above max.`);
    }
  }
  return errors;
}

export function validateDraft(draft: EventTypeDraft, creating: boolean): string[] {
  const errors: string[] = [];
  if (!draft.name.trim()) errors.push('Name is required.');
  else if (creating && !slugify(draft.name)) {
    errors.push('Name must contain at least one letter or digit.');
  }
  draft.fields.forEach((field, i) => errors.push(...fieldErrors(field, i + 1)));
  return errors;
}

function toFieldRequest(field: FieldDraft, key: string): EventFieldRequest {
  const request: EventFieldRequest = {
    key,
    label: field.label.trim(),
    kind: field.kind,
    isRequired: field.kind === 'bool' ? false : field.isRequired,
  };
  if (field.kind === 'select') request.options = parseOptions(field.options);
  if (field.kind === 'number') {
    const min = parseBound(field.min);
    const max = parseBound(field.max);
    if (min !== null) request.min = min;
    if (max !== null) request.max = max;
    if (field.unit.trim()) request.unit = field.unit.trim();
  }
  return request;
}

/** Update body for a valid draft (the type key is immutable and not sent). */
export function toTypeRequest(draft: EventTypeDraft): EventTypeRequest {
  const keys = resolveKeys(draft.fields);
  return {
    name: draft.name.trim(),
    icon: draft.icon,
    color: draft.color,
    hasDuration: draft.hasDuration,
    fields: draft.fields.map((f, i) => toFieldRequest(f, keys[i])),
  };
}

/** Create body for a valid draft: the key is the slug of the name. */
export function toCreateRequest(draft: EventTypeDraft): CreateEventTypeRequest {
  return { key: slugify(draft.name), ...toTypeRequest(draft) };
}
