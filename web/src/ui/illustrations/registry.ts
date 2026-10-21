/*
 * Original illustrations of Baby Routine, by the project contributors, licensed under the project
 * licence (AGPL-3.0-or-later). See docs/design/ILLUSTRATIONS.md.
 */
import type { ComponentType } from 'react';
import type { CategoryName } from '../../theme/tokens';
import { BathIllustration, DiaperIllustration, TummyTimeIllustration } from './care';
import { CustomIllustration } from './custom';
import {
  BottleIllustration,
  NursingIllustration,
  PumpingIllustration,
  SolidFoodIllustration,
} from './feeding';
import { FallbackIllustration } from './FallbackIllustration';
import { BellyPainIllustration, MedicationIllustration, TemperatureIllustration } from './health';
import type { IllustrationProps } from './IllustrationFrame';
import {
  BedtimeIllustration,
  FellAsleepIllustration,
  NapIllustration,
  NightSleepIllustration,
  NightWakingIllustration,
  WokeUpIllustration,
} from './sleep';

export type IllustrationComponent = ComponentType<IllustrationProps>;

export interface IllustrationEntry {
  component: IllustrationComponent;
  /** Category whose tinted tile the illustration sits on. */
  category: CategoryName;
}

/** Every illustration, by its canonical name, in gallery order. */
export const ILLUSTRATIONS = {
  nap: { component: NapIllustration, category: 'sleep' },
  night: { component: NightSleepIllustration, category: 'sleep' },
  woke_up: { component: WokeUpIllustration, category: 'sleep' },
  bedtime: { component: BedtimeIllustration, category: 'sleep' },
  fell_asleep: { component: FellAsleepIllustration, category: 'sleep' },
  night_waking: { component: NightWakingIllustration, category: 'nightWaking' },
  bottle: { component: BottleIllustration, category: 'feeding' },
  nursing: { component: NursingIllustration, category: 'feeding' },
  pumping: { component: PumpingIllustration, category: 'feeding' },
  solid_food: { component: SolidFoodIllustration, category: 'feeding' },
  diaper: { component: DiaperIllustration, category: 'diaper' },
  medication: { component: MedicationIllustration, category: 'health' },
  temperature: { component: TemperatureIllustration, category: 'health' },
  bath: { component: BathIllustration, category: 'care' },
  tummy_time: { component: TummyTimeIllustration, category: 'activity' },
  belly_pain: { component: BellyPainIllustration, category: 'health' },
  custom: { component: CustomIllustration, category: 'custom' },
} as const satisfies Record<string, IllustrationEntry>;

export type IllustrationName = keyof typeof ILLUSTRATIONS;

export const ILLUSTRATION_NAMES = Object.keys(ILLUSTRATIONS) as IllustrationName[];

/**
 * Keys the app already uses, to the illustration that draws them: built-in preset ids
 * (`presets/catalogue.ts`), built-in event type keys (`BuiltInEventTypes` in the API), sleep kinds
 * and feeding methods (payload options). A Map, so a server-provided key such as `constructor`
 * never resolves to an inherited member.
 */
const ALIASES: ReadonlyMap<string, IllustrationName> = new Map<string, IllustrationName>(
  Object.entries({
    // Preset ids.
    wake_up: 'woke_up',
    nap: 'nap',
    bedtime: 'bedtime',
    fell_asleep: 'fell_asleep',
    night_waking: 'night_waking',
    bottle: 'bottle',
    nursing: 'nursing',
    pumping: 'pumping',
    diaper: 'diaper',
    medication: 'medication',
    belly_pain: 'belly_pain',
    bath: 'bath',
    tummy_time: 'tummy_time',
    custom: 'custom',
    // Built-in event type keys (diaper, medication, belly_pain, bath, tummy_time above).
    sleep: 'nap',
    feeding: 'bottle',
    breast_pump: 'pumping',
    // Sleep kinds (nap, night_waking, fell_asleep above).
    night: 'night',
    bed_time: 'bedtime',
    woke_up: 'woke_up',
    // Feeding methods and other concepts.
    breast: 'nursing',
    solid: 'solid_food',
    solid_food: 'solid_food',
    temperature: 'temperature',
  } satisfies Record<string, IllustrationName>),
);

/** Canonical illustration name of a preset id, type key or option, or `undefined`. */
export function illustrationName(key: string): IllustrationName | undefined {
  return ALIASES.get(key);
}

/**
 * The component that draws `key` (preset id, built-in event type key, sleep kind, feeding method
 * or canonical name). Anything else gets `FallbackIllustration`: the category icon in its tile.
 */
export function illustrationFor(key: string): IllustrationComponent {
  const name = illustrationName(key);
  return name ? ILLUSTRATIONS[name].component : FallbackIllustration;
}
