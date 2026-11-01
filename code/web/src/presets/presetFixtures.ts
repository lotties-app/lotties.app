import type { BabyEvent, EventType } from '../db/models';
import { BABY_ID } from '../test/fakeApi';
import { presetsForBaby } from './resolve';
import type { Preset } from './types';

export const SLEEP = 'type-sleep';
export const FEEDING_T = 'type-feeding-t';
export const DIAPER_T = 'type-diaper-t';

export function eventType(overrides: Partial<EventType> & { id: string; key: string }): EventType {
  return {
    babyId: null,
    name: overrides.key,
    icon: 'star',
    color: '#4f8ef7',
    hasDuration: false,
    fields: [],
    ...overrides,
  };
}

/** Built-in templates the way the API serves them (subset used by the tests). */
export const BUILT_IN_TYPES: EventType[] = [
  eventType({ id: SLEEP, key: 'sleep', name: 'Sleep', hasDuration: true }),
  eventType({ id: FEEDING_T, key: 'feeding', name: 'Feeding', hasDuration: true }),
  eventType({ id: DIAPER_T, key: 'diaper', name: 'Diaper' }),
  eventType({ id: 'type-bath', key: 'bath', name: 'Bath' }),
  eventType({ id: 'type-tummy', key: 'tummy_time', name: 'Tummy time', hasDuration: true }),
  eventType({ id: 'type-med', key: 'medication', name: 'Medication' }),
  eventType({ id: 'type-belly', key: 'belly_pain', name: 'Belly pain' }),
  eventType({ id: 'type-pump', key: 'breast_pump', name: 'Breast pump', hasDuration: true }),
  eventType({ id: 'type-nasal', key: 'nasal_suction', name: 'Nasal suction' }),
  eventType({ id: 'type-massage', key: 'belly_massage', name: 'Belly massage', hasDuration: true }),
  eventType({ id: 'type-fussy', key: 'fussy', name: 'Fussy / crying', hasDuration: true }),
  eventType({ id: 'type-nail', key: 'nail_trim', name: 'Nail trim' }),
  eventType({ id: 'type-temperature', key: 'temperature', name: 'Temperature' }),
  eventType({ id: 'type-spit', key: 'spit_up', name: 'Spit-up / vomit' }),
  eventType({ id: 'type-teething', key: 'teething', name: 'Teething' }),
  eventType({ id: 'type-milestone', key: 'milestone', name: 'Milestone' }),
  eventType({ id: 'type-symptom', key: 'symptom', name: 'Symptom' }),
  eventType({ id: 'type-outdoor', key: 'outdoor', name: 'Outdoor time', hasDuration: true }),
  eventType({ id: 'type-skin', key: 'skin_care', name: 'Skin care' }),
];

export function presetById(id: string, types: EventType[] = BUILT_IN_TYPES): Preset {
  const preset = presetsForBaby(types).find((p) => p.id === id);
  if (!preset) throw new Error(`No preset ${id}`);
  return preset;
}

export function event(overrides: Partial<BabyEvent> & { id: string }): BabyEvent {
  return {
    babyId: BABY_ID,
    typeId: SLEEP,
    startedAt: '2026-10-21T08:00:00.000Z',
    endedAt: null,
    payload: {},
    notes: null,
    createdBy: null,
    createdAt: '2026-10-21T08:00:00.000Z',
    updatedAt: '2026-10-21T08:00:00.000Z',
    deletedAt: null,
    ...overrides,
  };
}
