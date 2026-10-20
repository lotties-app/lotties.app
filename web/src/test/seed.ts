import type { BabyRoutineDb } from '../db/database';
import type { Dosage, EventFieldDefinition, EventType, Medication } from '../db/models';
import { BABY_ID } from './fakeApi';

export const FEEDING = 'type-feeding';
export const DIAPER = 'type-diaper';
export const BELLY = 'type-belly';
export const MEDICATION = 'type-medication';

function field(overrides: Partial<EventFieldDefinition> & { key: string }): EventFieldDefinition {
  return {
    label: overrides.key,
    kind: 'text',
    isRequired: false,
    options: [],
    min: null,
    max: null,
    unit: null,
    ...overrides,
  };
}

function type(overrides: Partial<EventType> & { id: string; key: string }): EventType {
  return {
    babyId: null,
    name: overrides.key,
    icon: 'unknown_icon',
    color: '#4f8ef7',
    hasDuration: false,
    fields: [],
    ...overrides,
  };
}

export const EVENT_TYPES: EventType[] = [
  type({ id: FEEDING, key: 'feeding', name: 'Feeding', icon: 'local_drink', hasDuration: true }),
  type({
    id: DIAPER,
    key: 'diaper',
    name: 'Diaper',
    icon: 'baby_changing_station',
    fields: [
      field({
        key: 'content',
        label: 'Content',
        kind: 'select',
        isRequired: true,
        options: ['WET', 'DIRTY', 'MIXED'],
      }),
    ],
  }),
  type({
    id: BELLY,
    key: 'belly_pain',
    name: 'Belly pain',
    icon: 'sick',
    fields: [
      field({
        key: 'intensity',
        label: 'Intensity',
        kind: 'number',
        isRequired: true,
        min: 1,
        max: 5,
      }),
    ],
  }),
  type({ id: MEDICATION, key: 'medication', name: 'Medication', icon: 'medication' }),
];

function med(id: string, name: string, isUsual: boolean, defaultDosage: Dosage | null = null) {
  return {
    id,
    babyId: BABY_ID,
    name,
    defaultDosage,
    notes: null,
    isUsual,
    createdAt: '2026-10-01T00:00:00.000Z',
  } satisfies Medication;
}

export async function seedBaby(db: BabyRoutineDb, extras: { medications?: boolean } = {}) {
  await db.babies.put({ id: BABY_ID, name: 'Lia', birthDate: '2026-08-01' });
  await db.eventTypes.bulkPut(EVENT_TYPES);
  if (extras.medications) {
    await db.medications.bulkPut([
      med('m-b', 'Beta drops', false),
      med('m-z', 'Zeta syrup', true, { amount: 2.5, unit: 'ml' }),
      med('m-a', 'Alpha tablet', true),
    ]);
  }
}
