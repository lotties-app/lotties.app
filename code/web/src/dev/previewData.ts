import type { EventType, Medication } from '../db/models';
import { DIAPER_TYPE, FEEDING_TYPE, SLEEP_TYPE, TUMMY_TIME_TYPE } from '../test/builtInTypes';

/*
 * Shared by the developer-only previews of the Day screen and the event sheet (`/dev/day`,
 * `/dev/sheet`, never in production builds): the baby's event types and medications, and the
 * toolbar that switches colour scheme and language.
 */

export const PREVIEW_BABY_ID = 'dev-day-baby';

const field = (
  key: string,
  extra: Partial<EventType['fields'][number]> = {},
): EventType['fields'][number] => ({
  key,
  label: key,
  kind: 'text',
  isRequired: false,
  options: [],
  min: null,
  max: null,
  unit: null,
  ...extra,
});

const extraType = (
  key: string,
  name: string,
  icon: string,
  hasDuration = false,
  fields: EventType['fields'] = [],
): EventType => ({
  id: `dev-${key}`,
  babyId: null,
  key,
  name,
  icon,
  color: '#4f8ef7',
  hasDuration,
  fields,
});

export const PREVIEW_TYPES: EventType[] = [
  FEEDING_TYPE,
  SLEEP_TYPE,
  DIAPER_TYPE,
  extraType('medication', 'Medication', 'medication'),
  extraType('belly_pain', 'Belly pain', 'sick', false, [
    field('intensity', { kind: 'number', isRequired: true, min: 1, max: 5 }),
  ]),
  extraType('bath', 'Bath', 'bathtub', true, [
    field('temperature_c', { kind: 'number', min: 30, max: 42, unit: 'C' }),
    field('pause_count', { kind: 'number', min: 0, max: 100, hidden: true, integer: true }),
    field('paused_seconds', { kind: 'number', min: 0, max: 86400, hidden: true, integer: true }),
    field('paused_at', { hidden: true }),
  ]),
  TUMMY_TIME_TYPE,
];

export const typeIdOf = (key: string): string =>
  PREVIEW_TYPES.find((type) => type.key === key)?.id ?? key;

export const PREVIEW_MEDICATIONS: Medication[] = [
  ['m1', 'Colidis', true, { amount: 5, unit: 'drops' }],
  ['m2', 'Vitamin D', true, null],
  ['m3', 'Paracetamol', false, { amount: 2.5, unit: 'ml' }],
].map(([id, name, isUsual, defaultDosage]) => ({
  id: id as string,
  babyId: PREVIEW_BABY_ID,
  name: name as string,
  isUsual: isUsual as boolean,
  defaultDosage: defaultDosage as Medication['defaultDosage'],
  notes: null,
  createdAt: '2026-10-01T00:00:00.000Z',
}));
