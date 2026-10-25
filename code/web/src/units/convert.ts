/*
 * Pure conversions between the canonical metric storage and US customary display
 * (docs/design/37-measurement-units.md; shared vectors in unitsVectors.json, the API runs the same
 * file in C#). Storage is metric forever; these functions only change what a person sees and types.
 * Input rounding (back to metric): volume to whole ml, weight to whole grams, length to 0.1 cm,
 * temperature to 0.1 C. Display rounding lives in `format.ts`.
 */

const ML_PER_FL_OZ = 29.5735;
const G_PER_OZ = 28.3495;
const OZ_PER_LB = 16;
const CM_PER_IN = 2.54;

const roundTo = (value: number, digits: number) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

export const mlToFlOz = (ml: number) => ml / ML_PER_FL_OZ;
/** Whole ml. */
export const flOzToMl = (oz: number) => Math.round(oz * ML_PER_FL_OZ);

export interface PoundsOunces {
  lb: number;
  oz: number;
}

/** Whole ounces, split into pounds and the ounces left (0-15). */
export function kgToLbOz(kg: number): PoundsOunces {
  const totalOz = Math.round((kg * 1000) / G_PER_OZ);
  return { lb: Math.floor(totalOz / OZ_PER_LB), oz: totalOz % OZ_PER_LB };
}

/** Whole grams, as kg (3 decimals). */
export function lbOzToKg(lb: number, oz: number): number {
  return Math.round((lb * OZ_PER_LB + oz) * G_PER_OZ) / 1000;
}

/** Decimal pounds (for a chart axis). */
export const kgToLb = (kg: number) => (kg * 1000) / G_PER_OZ / OZ_PER_LB;

export const cmToIn = (cm: number) => cm / CM_PER_IN;
/** To 0.1 cm. */
export const inToCm = (inches: number) => roundTo(inches * CM_PER_IN, 1);

export const cToF = (c: number) => (c * 9) / 5 + 32;
/** To 0.1 C. */
export const fToC = (f: number) => roundTo(((f - 32) * 5) / 9, 1);

/** Display rounding: `digits` decimals. */
export const roundDisplay = roundTo;
