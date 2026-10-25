import type { Locale } from '../i18n/config';
import { cToF, cmToIn, kgToLbOz, mlToFlOz } from './convert';
import type { UnitSystem } from './system';

/*
 * Display text of a metric value in the chosen system. Pure: system and locale are arguments (the
 * hook `useUnits` supplies them). Numbers go through `Intl.NumberFormat` (the locale's decimal
 * separator); unit names through its `style: 'unit'` where the output is good, hand-built where it
 * is not (temperature: `37 °C` with a space in every language).
 */

const formatters = new Map<string, Intl.NumberFormat>();

function formatter(locale: string, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  let found = formatters.get(key);
  if (!found) {
    found = new Intl.NumberFormat(locale, options);
    formatters.set(key, found);
  }
  return found;
}

export type IntlUnit =
  'milliliter' | 'fluid-ounce' | 'kilogram' | 'pound' | 'ounce' | 'centimeter' | 'inch';

function withUnit(value: number, unit: IntlUnit, locale: string, digits?: number): string {
  return formatter(locale, {
    style: 'unit',
    unit,
    unitDisplay: 'short',
    ...(digits !== undefined ? { maximumFractionDigits: digits } : {}),
  }).format(value);
}

/** A plain number with at most `digits` decimals (trailing zeros dropped). */
export function numberText(value: number, locale: string, digits = 1): string {
  return formatter(locale, { maximumFractionDigits: digits }).format(value);
}

/** The same number with exactly `digits` decimals ("4.0"): for the text in a stepper. */
export function fixedText(value: number, locale: string, digits: number): string {
  return formatter(locale, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
    useGrouping: false,
  }).format(value);
}

/** `120 ml` (the app's spelling in every language); `4.1 fl oz`. */
export function formatVolume(ml: number, system: UnitSystem, locale: Locale | string): string {
  return system === 'us'
    ? withUnit(mlToFlOz(ml), 'fluid-ounce', locale, 1)
    : `${numberText(ml, locale, 3)} ml`;
}

/** The number alone of a volume (`120`, `4.1`), for text that names the unit once (`80 of 120 ml`). */
export function volumeNumber(ml: number, system: UnitSystem, locale: Locale | string): string {
  return system === 'us' ? numberText(mlToFlOz(ml), locale, 1) : numberText(ml, locale, 3);
}

/** `3.5 kg`; `7 lb 11 oz` (whole ounces; under a pound only ounces). */
export function formatWeight(kg: number, system: UnitSystem, locale: Locale | string): string {
  if (system !== 'us') return withUnit(kg, 'kilogram', locale);
  const { lb, oz } = kgToLbOz(kg);
  if (lb === 0) return withUnit(oz, 'ounce', locale, 0);
  if (oz === 0) return withUnit(lb, 'pound', locale, 0);
  return `${withUnit(lb, 'pound', locale, 0)} ${withUnit(oz, 'ounce', locale, 0)}`;
}

/** `50 cm`; `19.7 in` (pt-BR: `19,7 pol.`). */
export function formatLength(cm: number, system: UnitSystem, locale: Locale | string): string {
  return system === 'us'
    ? withUnit(cmToIn(cm), 'inch', locale, 1)
    : withUnit(cm, 'centimeter', locale);
}

/** `37 °C`; `98.6 °F`. */
export function formatTemperature(c: number, system: UnitSystem, locale: Locale | string): string {
  return system === 'us'
    ? `${numberText(cToF(c), locale, 1)} °F`
    : `${numberText(c, locale, 1)} °C`;
}

/** Unit suffixes for fields and axes. */
export const unitLabels = (locale: Locale | string, system: UnitSystem) => ({
  volume: system === 'us' ? 'fl oz' : 'ml',
  weight: system === 'us' ? 'lb' : 'kg',
  weightSmall: system === 'us' ? 'oz' : 'g',
  length: system === 'us' ? (locale.startsWith('pt') ? 'pol.' : 'in') : 'cm',
  temperature: system === 'us' ? '°F' : '°C',
});
