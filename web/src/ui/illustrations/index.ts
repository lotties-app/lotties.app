/*
 * Original illustrations of Baby Routine, by the project contributors, licensed under the project
 * licence (AGPL-3.0-or-later). See docs/design/ILLUSTRATIONS.md for the style guide.
 *
 * Public API of the illustrated category icons: the registry (`illustrationFor`,
 * `illustrationName`, `ILLUSTRATIONS`), the `Illustration` component (by key, themed) and every
 * concept component.
 */
export {
  ILLUSTRATIONS,
  ILLUSTRATION_NAMES,
  illustrationFor,
  illustrationName,
  type IllustrationComponent,
  type IllustrationEntry,
  type IllustrationName,
} from './registry';
export { Illustration, type IllustrationByNameProps } from './Illustration';
export { FallbackIllustration, type FallbackIllustrationProps } from './FallbackIllustration';
export type { IllustrationProps } from './IllustrationFrame';
export {
  BedtimeIllustration,
  FellAsleepIllustration,
  NapIllustration,
  NightSleepIllustration,
  NightWakingIllustration,
  WokeUpIllustration,
} from './sleep';
export {
  BottleIllustration,
  NursingIllustration,
  PumpingIllustration,
  SolidFoodIllustration,
} from './feeding';
export { BathIllustration, DiaperIllustration, TummyTimeIllustration } from './care';
export { BellyPainIllustration, MedicationIllustration, TemperatureIllustration } from './health';
export { CustomIllustration } from './custom';
