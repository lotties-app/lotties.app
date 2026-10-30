import { parseLocaleNumber } from '../ui/form/numbers';
import { fToC, flOzToMl, inToCm, lbOzToKg } from './convert';
import type { UnitSystem } from './system';

/*
 * What a person typed, back to the canonical metric value (`null`: not a number). Comma or dot is
 * accepted whatever the language. Metric text is taken as typed; US text is converted and rounded
 * to the storage precision (whole ml, whole grams, 0.1 cm, 0.1 C).
 */

export function parseVolume(text: string, system: UnitSystem): number | null {
  const value = parseLocaleNumber(text);
  if (value === null) return null;
  return system === 'us' ? flOzToMl(value) : value;
}

export function parseLength(text: string, system: UnitSystem): number | null {
  const value = parseLocaleNumber(text);
  if (value === null) return null;
  return system === 'us' ? inToCm(value) : value;
}

export function parseTemperature(text: string, system: UnitSystem): number | null {
  const value = parseLocaleNumber(text);
  if (value === null) return null;
  return system === 'us' ? fToC(value) : value;
}

/** Metric weight: one field in kg. */
export function parseWeightKg(text: string): number | null {
  return parseLocaleNumber(text);
}

/**
 * US weight: two fields, pounds and ounces. An empty field counts as 0, but not both empty. The
 * ounces may exceed 15 (they carry into the pounds through the gram conversion).
 */
export function parseWeightLbOz(lbText: string, ozText: string): number | null {
  if (lbText.trim() === '' && ozText.trim() === '') return null;
  const lb = lbText.trim() === '' ? 0 : parseLocaleNumber(lbText);
  const oz = ozText.trim() === '' ? 0 : parseLocaleNumber(ozText);
  if (lb === null || oz === null || lb < 0 || oz < 0) return null;
  return lbOzToKg(lb, oz);
}
