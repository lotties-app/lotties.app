import { fireEvent, screen } from '@testing-library/react';
import type { BabyRoutineDb } from '../../db/database';
import type {
  Baby,
  BabyEvent,
  BabyRole,
  EventPayload,
  EventType,
  Medication,
} from '../../db/models';
import type { PredictionsDto } from '../../sync/contract';
import { DIAPER_TYPE, FEEDING_TYPE, SLEEP_TYPE } from '../../test/builtInTypes';
import { BABY_ID, type ApiCall } from '../../test/fakeApi';
import { eventType } from '../../presets/presetFixtures';

/*
 * Test kit of the Now screen tests: a baby with the real built-in types (feeding with its
 * conditional fields, sleep, diaper) plus simple medication, belly pain, bath and tummy time types,
 * events placed "N minutes ago", and a predictions response for the fake API.
 */

export const MEDICATION_TYPE = eventType({ id: 'type-med', key: 'medication', name: 'Medication' });
export const BATH_TYPE = eventType({ id: 'type-bath', key: 'bath', name: 'Bath' });
export const TUMMY_TYPE = eventType({
  id: 'type-tummy',
  key: 'tummy_time',
  name: 'Tummy time',
  hasDuration: true,
});
export const BELLY_TYPE: EventType = eventType({
  id: 'type-belly',
  key: 'belly_pain',
  name: 'Belly pain',
  fields: [
    {
      key: 'intensity',
      label: 'Intensity',
      kind: 'number',
      isRequired: true,
      options: [],
      min: 1,
      max: 5,
      unit: null,
    },
  ],
});

export const NOW_TYPES: EventType[] = [
  FEEDING_TYPE,
  SLEEP_TYPE,
  DIAPER_TYPE,
  MEDICATION_TYPE,
  BELLY_TYPE,
  BATH_TYPE,
  TUMMY_TYPE,
];

export const BABY: Baby = { id: BABY_ID, name: 'Lia', birthDate: '2026-08-01', role: 'Owner' };

export const MEDS: Medication[] = [
  {
    id: 'm-colidis',
    babyId: BABY_ID,
    name: 'Colidis',
    defaultDosage: { amount: 5, unit: 'drops' },
    notes: null,
    isUsual: true,
    createdAt: '2026-10-01T00:00:00.000Z',
  },
  {
    id: 'm-paracetamol',
    babyId: BABY_ID,
    name: 'Paracetamol',
    defaultDosage: null,
    notes: null,
    isUsual: false,
    createdAt: '2026-10-01T00:00:00.000Z',
  },
];

export interface SeedOptions {
  role?: BabyRole;
  types?: EventType[];
  medications?: boolean;
}

export async function seedNow(db: BabyRoutineDb, options: SeedOptions = {}) {
  await db.babies.put({ ...BABY, role: options.role ?? 'Owner' });
  await db.eventTypes.bulkPut(options.types ?? NOW_TYPES);
  if (options.medications !== false) await db.medications.bulkPut(MEDS);
}

export const minutesAgo = (minutes: number) =>
  new Date(Date.now() - minutes * 60_000).toISOString();

const TYPE_ID: Record<string, string> = Object.fromEntries(
  NOW_TYPES.map((type) => [type.key, type.id]),
);

let counter = 0;

/** Puts an event of the built-in type `key` that started `startAgo` minutes ago (`endAgo`: null = running). */
export async function putEvent(
  db: BabyRoutineDb,
  key: 'feeding' | 'sleep' | 'diaper' | 'medication' | 'belly_pain' | 'bath' | 'tummy_time',
  startAgo: number,
  endAgo: number | null,
  payload: EventPayload = {},
  extra: Partial<BabyEvent> = {},
): Promise<BabyEvent> {
  counter += 1;
  const startedAt = minutesAgo(startAgo);
  const stored: BabyEvent = {
    id: `evt-${counter}`,
    babyId: BABY_ID,
    typeId: TYPE_ID[key],
    startedAt,
    endedAt: endAgo === null ? null : minutesAgo(endAgo),
    payload,
    notes: null,
    createdBy: null,
    createdAt: startedAt,
    updatedAt: startedAt,
    deletedAt: null,
    ...extra,
  };
  await db.events.put(stored);
  return stored;
}

/** A normal morning: a nap that ended `awakeMin` minutes ago, a bottle and a wet diaper. */
export async function seedMorning(db: BabyRoutineDb, awakeMin = 112) {
  await putEvent(db, 'sleep', awakeMin + 70, awakeMin, { kind: 'nap' });
  await putEvent(db, 'feeding', awakeMin + 130, awakeMin + 130, {
    method: 'bottle',
    amount_ml: 120,
    bottle_feeding_type: 'formula',
  });
  await putEvent(db, 'diaper', awakeMin + 30, awakeMin + 30, { content: 'WET' });
}

/** The server's sleep prediction: a window around now (`opensInMin` minutes from now, 15 min wide). */
export function sleepPredictions(opensInMin = -5): PredictionsDto {
  return {
    babyId: BABY_ID,
    generatedAt: new Date().toISOString(),
    insufficientData: [],
    predictions: [
      {
        typeKey: 'sleep',
        confidence: 'Medium',
        sampleCount: 18,
        reason: '',
        expectedDuration: { minutes: 75, sampleCount: 12 },
        nextStart: {
          earliest: minutesAgo(-opensInMin),
          expected: minutesAgo(-opensInMin - 8),
          latest: minutesAgo(-opensInMin - 15),
        },
        basis: {
          kind: 'AwakeWindow',
          medianGapMinutes: 105,
          lookBackDays: 7,
          ageBand: '0-3m',
          dayPhase: 'day',
          assumesEventInProgressEnds: false,
        },
      },
    ],
  };
}

export const learningPredictions = (): PredictionsDto => ({
  babyId: BABY_ID,
  generatedAt: new Date().toISOString(),
  predictions: [],
  insufficientData: [{ typeKey: 'sleep', sampleCount: 1, requiredSamples: 3, reason: '' }],
});

/** A fake API handler serving `predictions` and the member list. */
export function nowApi(predictions: PredictionsDto | null = null) {
  return (call: ApiCall) => {
    if (call.path.includes('/predictions') && predictions) return predictions;
    if (call.path.endsWith('/members')) {
      return [{ userId: 'u-ana', displayName: 'Ana', role: 'Parent', joinedAt: '2026-10-01' }];
    }
    return undefined;
  };
}

/**
 * Pauses the toast's 6 s countdown like a pointer resting on it would (a loaded test run can take
 * longer than 6 s between two steps), and returns it.
 */
export async function holdToast(): Promise<HTMLElement> {
  const toast = await screen.findByTestId('quick-log-toast');
  fireEvent.pointerEnter(toast);
  return toast;
}
