import { use, useMemo, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { isLocale, DEFAULT_LOCALE, type Locale } from '../i18n/config';
import {
  fixedText,
  formatLength,
  formatTemperature,
  formatVolume,
  formatWeight,
  numberText,
  volumeNumber,
  unitLabels,
} from './format';
import {
  parseLength,
  parseTemperature,
  parseVolume,
  parseWeightKg,
  parseWeightLbOz,
} from './parse';
import { currentUnitSystem, getUnitSetting, subscribeUnits } from './state';
import type { UnitSystem } from './system';
import { UnitsContext, type UnitsApi } from './UnitsContext';

/** What a screen needs to show and read measurements in the chosen system (storage stays metric). */
export interface Units {
  system: UnitSystem;
  locale: Locale;
  /** `120 mL` / `4.1 fl oz` from ml. */
  formatVolume: (ml: number) => string;
  /** `120` / `4.1`: the volume number alone (the unit named once elsewhere). */
  volumeNumber: (ml: number) => string;
  /** `3.5 kg` / `7 lb 11 oz` from kg. */
  formatWeight: (kg: number) => string;
  /** `50 cm` / `19.7 in` from cm. */
  formatLength: (cm: number) => string;
  /** `37 °C` / `98.6 °F` from degrees C. */
  formatTemperature: (c: number) => string;
  /** Typed text back to ml / cm / degrees C (`null`: not a number). */
  parseVolume: (text: string) => number | null;
  parseLength: (text: string) => number | null;
  parseTemperature: (text: string) => number | null;
  /** Metric weight: one kg field. */
  parseWeightKg: (text: string) => number | null;
  /** US weight: pounds and ounces fields, back to kg. */
  parseWeightLbOz: (lbText: string, ozText: string) => number | null;
  /** Suffixes: `ml`/`fl oz`, `kg`/`lb`, `g`/`oz`, `cm`/`in`, `°C`/`°F`. */
  labels: ReturnType<typeof unitLabels>;
  /** A number in the display system's precision, locale decimal separator. */
  number: (value: number, digits?: number) => string;
  fixed: (value: number, digits: number) => string;
}

export function useUnits(): Units {
  const { i18n } = useTranslation();
  const system = useSyncExternalStore(subscribeUnits, currentUnitSystem, currentUnitSystem);
  const locale = isLocale(i18n.language) ? i18n.language : DEFAULT_LOCALE;
  return useMemo<Units>(
    () => ({
      system,
      locale,
      formatVolume: (ml) => formatVolume(ml, system, locale),
      volumeNumber: (ml) => volumeNumber(ml, system, locale),
      formatWeight: (kg) => formatWeight(kg, system, locale),
      formatLength: (cm) => formatLength(cm, system, locale),
      formatTemperature: (c) => formatTemperature(c, system, locale),
      parseVolume: (text) => parseVolume(text, system),
      parseLength: (text) => parseLength(text, system),
      parseTemperature: (text) => parseTemperature(text, system),
      parseWeightKg,
      parseWeightLbOz,
      labels: unitLabels(locale, system),
      number: (value, digits = 1) => numberText(value, locale, digits),
      fixed: (value, digits) => fixedText(value, locale, digits),
    }),
    [system, locale],
  );
}

/** The setting and its setter (the Settings screen); without a provider a read-only fallback. */
export function useUnitSettings(): UnitsApi {
  const api = use(UnitsContext);
  const system = useSyncExternalStore(subscribeUnits, currentUnitSystem, currentUnitSystem);
  return api ?? { setting: getUnitSetting(), system, pending: false, setSetting: () => {} };
}
