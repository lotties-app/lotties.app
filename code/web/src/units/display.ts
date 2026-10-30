import { currentLocale } from '../i18n/i18n';
import {
  formatLength,
  formatTemperature,
  formatVolume,
  formatWeight,
  numberText,
  volumeNumber,
} from './format';
import { cToF } from './convert';
import { currentUnitSystem } from './state';

/*
 * Display helpers for code that is not a React component (text builders such as `tileText`,
 * `payloadSummary`, `rhythmDetails`): they read the unit system and the language from module state,
 * like `formatDuration` reads the language. Components use `useUnits()` instead, which also
 * re-renders; both give the same text. Values are always canonical metric.
 */

/** `120 ml` / `4.1 fl oz`. */
export const volumeText = (ml: number) => formatVolume(ml, currentUnitSystem(), currentLocale());
/** `120` / `4.1`: the number of a volume without its unit. */
export const volumeNumberText = (ml: number) =>
  volumeNumber(ml, currentUnitSystem(), currentLocale());
export const weightText = (kg: number) => formatWeight(kg, currentUnitSystem(), currentLocale());
export const lengthText = (cm: number) => formatLength(cm, currentUnitSystem(), currentLocale());
export const temperatureText = (c: number) =>
  formatTemperature(c, currentUnitSystem(), currentLocale());

export type FieldQuantity = 'volume' | 'temperature';

/**
 * What a number field measures, from its declared unit: `ml` is a volume, `C` / `°C` a temperature
 * (built-in and custom event types alike). Any other unit is left alone (`null`).
 */
export function fieldQuantity(unit: string | null | undefined): FieldQuantity | null {
  if (unit === 'ml') return 'volume';
  if (unit === 'C' || unit === '°C') return 'temperature';
  return null;
}

/** The value of a number field with its unit in the person's system, or `null` for other units. */
export function fieldValueText(unit: string | null | undefined, value: number): string | null {
  const quantity = fieldQuantity(unit);
  if (quantity === 'volume') return volumeText(value);
  if (quantity === 'temperature') return temperatureText(value);
  return null;
}

/** Degrees as shown for a temperature in the person's system (number only). */
export const temperatureNumberText = (c: number) =>
  numberText(currentUnitSystem() === 'us' ? cToF(c) : c, currentLocale(), 1);
