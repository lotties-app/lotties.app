import { currentLocale } from '../../i18n/i18n';
import { formatNumber } from '../../i18n/format';
import type { Locale } from '../../i18n/config';

/**
 * Reads a number typed by a person. Both `7,5` and `7.5` work whatever the UI language: the last
 * separator is the decimal one when both appear (`1.234,5`, `1,234.5`). Anything else (letters,
 * a second decimal part) is `null`.
 */
export function parseLocaleNumber(text: string): number | null {
  const compact = text.replace(/\s/g, '');
  if (!/^[+-]?[\d.,]*\d[\d.,]*$/.test(compact)) return null;
  const lastComma = compact.lastIndexOf(',');
  const lastDot = compact.lastIndexOf('.');
  const decimalAt = Math.max(lastComma, lastDot);
  let normalized: string;
  if (decimalAt < 0) {
    normalized = compact;
  } else {
    const integerPart = compact.slice(0, decimalAt);
    // Separators before the decimal one are digit grouping: `1.234`, never `1.2`.
    if (/[.,]/.test(integerPart) && !/^[+-]?\d{1,3}([.,])\d{3}(\1\d{3})*$/.test(integerPart)) {
      return null;
    }
    const integer = integerPart.replace(/[.,]/g, '');
    const fraction = compact.slice(decimalAt + 1);
    if (/[.,]/.test(fraction)) return null;
    normalized = `${integer}.${fraction}`;
  }
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

/** Number of fraction digits of a step such as `0.5` (1) or `10` (0). */
export function decimalsOf(step: number): number {
  const text = String(step);
  const dot = text.indexOf('.');
  return dot < 0 ? 0 : text.length - dot - 1;
}

/** Rounds away binary floating point noise (`0.1 + 0.2`) to `decimals` places. */
export function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

/** A value as the input shows it: locale decimal separator, no grouping, up to `decimals` digits. */
export function formatDecimal(value: number, decimals: number, locale: Locale = currentLocale()) {
  return formatNumber(value, { useGrouping: false, maximumFractionDigits: decimals }, locale);
}
