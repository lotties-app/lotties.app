import type { PresetDefinition } from './types';

/**
 * Built-in presets in Track sheet order (docs/DESIGN.md section 3). Type keys and payload field
 * keys mirror `BuiltInEventTypes` in the API (sleep `kind`, feeding `method`, ...).
 */
export const BUILT_IN_PRESETS: readonly PresetDefinition[] = [
  {
    id: 'wake_up',
    label: 'Wake-up',
    category: 'sleep',
    icon: 'wake_up',
    typeKey: 'sleep',
    mode: 'instant',
    payloadDefaults: { kind: 'woke_up' },
    stopsSleepTimers: true,
  },
  {
    id: 'nap',
    label: 'Nap',
    category: 'sleep',
    icon: 'nap',
    typeKey: 'sleep',
    mode: 'timer',
    payloadDefaults: { kind: 'nap' },
  },
  {
    id: 'bedtime',
    label: 'Bedtime',
    category: 'sleep',
    icon: 'bedtime',
    typeKey: 'sleep',
    mode: 'instant',
    payloadDefaults: { kind: 'bed_time' },
  },
  {
    id: 'fell_asleep',
    label: 'Fell asleep',
    category: 'sleep',
    icon: 'fell_asleep',
    typeKey: 'sleep',
    mode: 'instant',
    payloadDefaults: { kind: 'fell_asleep' },
    startsInferredSleepTimer: true,
  },
  {
    id: 'night_waking',
    label: 'Night waking',
    category: 'nightWaking',
    icon: 'night_waking',
    typeKey: 'sleep',
    mode: 'timer',
    payloadDefaults: { kind: 'night_waking' },
  },
  {
    id: 'bottle',
    label: 'Bottle',
    category: 'feeding',
    icon: 'bottle',
    typeKey: 'feeding',
    // A timer like nursing: how long the baby took to drink it. Stopping asks for the amount.
    mode: 'timer',
    payloadDefaults: { method: 'bottle' },
  },
  {
    id: 'nursing',
    label: 'Nursing',
    category: 'feeding',
    icon: 'nursing',
    typeKey: 'feeding',
    mode: 'timer',
    payloadDefaults: { method: 'breast' },
  },
  {
    // Built-in `breast_pump` type (added after DESIGN.md section 3 was written).
    id: 'pumping',
    label: 'Pumping',
    category: 'feeding',
    icon: 'pumping',
    typeKey: 'breast_pump',
    mode: 'timer',
    payloadDefaults: {},
  },
  {
    id: 'diaper',
    label: 'Diaper',
    category: 'diaper',
    icon: 'diaper',
    typeKey: 'diaper',
    mode: 'sheet',
    payloadDefaults: {},
  },
  {
    id: 'medication',
    label: 'Medication',
    category: 'health',
    icon: 'medication',
    typeKey: 'medication',
    mode: 'sheet',
    payloadDefaults: {},
  },
  {
    id: 'belly_pain',
    label: 'Belly pain',
    category: 'health',
    icon: 'belly_pain',
    typeKey: 'belly_pain',
    mode: 'sheet',
    payloadDefaults: {},
  },
  {
    id: 'bath',
    label: 'Bath',
    category: 'care',
    icon: 'bath',
    typeKey: 'bath',
    mode: 'sheet',
    payloadDefaults: {},
    endsImmediately: true,
  },
  {
    id: 'tummy_time',
    label: 'Tummy time',
    category: 'activity',
    icon: 'tummy_time',
    typeKey: 'tummy_time',
    mode: 'timer',
    payloadDefaults: {},
  },
  {
    id: 'custom',
    label: 'Custom',
    category: 'custom',
    icon: 'custom',
    typeKey: '',
    mode: 'link',
    payloadDefaults: {},
    href: '/settings#event-types',
  },
];

/**
 * Pinned on Home, in this order, when the user has not chosen: Wake-up, Bottle, Diaper, Nap
 * (DESIGN.md section 3 says "Feeding": Bottle is its one-tap form). Ids, never event type ids, so
 * the order is the same on every device.
 */
export const DEFAULT_PINNED: readonly string[] = ['wake_up', 'bottle', 'diaper', 'nap'];
