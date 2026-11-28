import { mlToFlOz } from '../units/convert';
import type { UnitSystem } from '../units/system';
import type { MilkToday } from './todayStats';

/*
 * The "Milk today" card of the Now screen: drunk and prepared milk of today's finished bottles
 * (`MilkToday`, the same value as the Feeds note) and what was not drunk. Volumes are shown rounded
 * (0.1 fl oz, 0.001 ml), so "not drunk" is computed from the two ROUNDED numbers: the three numbers
 * on the card always add up as shown (prepared - drunk = not drunk), and a difference that rounds
 * away is not shown at all. Pure; the card formats the ml values with the units helpers.
 */

export interface ShownMilk {
  drunkMl: number;
  preparedMl: number;
  /** ml whose shown text is (shown prepared - shown drunk); 0 when nothing shows as not drunk. */
  notDrunkMl: number;
  /** Shown drunk as a share of shown prepared, 0 to 1 (the decorative bar). */
  drunkShare: number;
}

/** Decimals the units helpers show: 0.1 fl oz, up to 3 decimals of ml (`format.ts`). */
const shownDigits = (system: UnitSystem) => (system === 'us' ? 1 : 3);

const roundTo = (value: number, digits: number) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

/** The number shown for `ml` in the display unit, rounded as the units helpers round it. */
const shownNumber = (ml: number, system: UnitSystem) =>
  roundTo(system === 'us' ? mlToFlOz(ml) : ml, shownDigits(system));

/** Back from a number in the display unit to ml (unrounded: it formats back to the same number). */
const toMl = (value: number, system: UnitSystem) => (system === 'us' ? value / mlToFlOz(1) : value);

export function shownMilk(milk: MilkToday, system: UnitSystem): ShownMilk {
  const drunk = shownNumber(milk.drunkMl, system);
  const prepared = shownNumber(milk.preparedMl, system);
  const notDrunk = Math.max(0, roundTo(prepared - drunk, shownDigits(system)));
  return {
    drunkMl: milk.drunkMl,
    preparedMl: milk.preparedMl,
    notDrunkMl: toMl(notDrunk, system),
    drunkShare: prepared > 0 ? Math.min(1, drunk / prepared) : 0,
  };
}
