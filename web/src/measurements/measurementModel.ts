import type { MeasurementDto, MeasurementRequest } from '../sync/contract';

export type MetricKey = 'weightKg' | 'heightCm' | 'headCircumferenceCm';

export interface MetricInfo {
  key: MetricKey;
  label: string;
  unit: string;
  min: number;
  max: number;
}

/** Ranges mirror the API rules (docs/SPEC.md "Measurements"). */
export const METRICS: readonly MetricInfo[] = [
  { key: 'weightKg', label: 'Weight', unit: 'kg', min: 0.3, max: 40 },
  { key: 'heightCm', label: 'Height', unit: 'cm', min: 20, max: 130 },
  { key: 'headCircumferenceCm', label: 'Head circumference', unit: 'cm', min: 20, max: 60 },
];

export const MIN_DATE = '2000-01-01';
export const MAX_NOTES = 1000;

export interface MeasurementForm {
  date: string;
  weightKg: string;
  heightCm: string;
  headCircumferenceCm: string;
  notes: string;
}

export type FormErrors = Partial<Record<keyof MeasurementForm | 'values', string>>;

/** Local calendar date `yyyy-mm-dd`. */
export function todayLocal(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function emptyForm(now: Date = new Date()): MeasurementForm {
  return { date: todayLocal(now), weightKg: '', heightCm: '', headCircumferenceCm: '', notes: '' };
}

export function formFromDto(dto: MeasurementDto): MeasurementForm {
  const text = (n: number | null) => (n === null ? '' : String(n));
  return {
    date: dto.date,
    weightKg: text(dto.weightKg),
    heightCm: text(dto.heightCm),
    headCircumferenceCm: text(dto.headCircumferenceCm),
    notes: dto.notes ?? '',
  };
}

function parseNumber(raw: string): number {
  return Number(raw.trim().replace(',', '.'));
}

export type ValidationResult =
  { ok: true; request: MeasurementRequest } | { ok: false; errors: FormErrors };

/** Validates the form with the API's rules and builds the request body. */
export function validateForm(form: MeasurementForm, now: Date = new Date()): ValidationResult {
  const errors: FormErrors = {};
  const values: Record<MetricKey, number | null> = {
    weightKg: null,
    heightCm: null,
    headCircumferenceCm: null,
  };

  if (!form.date) errors.date = 'Pick a date.';
  else if (form.date > todayLocal(now)) errors.date = 'The date cannot be in the future.';
  else if (form.date < MIN_DATE) errors.date = 'The date is too far in the past.';

  for (const metric of METRICS) {
    const raw = form[metric.key].trim();
    if (!raw) continue;
    const n = parseNumber(raw);
    if (!Number.isFinite(n) || n < metric.min || n > metric.max) {
      errors[metric.key] =
        `${metric.label} must be between ${metric.min} and ${metric.max} ${metric.unit}.`;
    } else {
      values[metric.key] = Math.round(n * 100) / 100;
    }
  }
  if (!METRICS.some((m) => form[m.key].trim())) {
    errors.values = 'Enter at least one of weight, height or head circumference.';
  }
  if (form.notes.length > MAX_NOTES) errors.notes = `Notes can have up to ${MAX_NOTES} characters.`;

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, request: { date: form.date, ...values, notes: form.notes.trim() || null } };
}

export interface SeriesPoint {
  /** `yyyy-mm-dd`. */
  date: string;
  value: number;
}

/** Points of one metric ordered by date ascending. */
export function seriesFor(measurements: MeasurementDto[], key: MetricKey): SeriesPoint[] {
  return measurements
    .filter((m) => m[key] !== null)
    .map((m) => ({ date: m.date, value: m[key] as number }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Newest first, so the list does not depend on the server's order. */
export function sortNewestFirst(measurements: MeasurementDto[]): MeasurementDto[] {
  return [...measurements].sort(
    (a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt),
  );
}

export const MEASUREMENT_ERROR_MESSAGES: Record<string, string> = {
  validation_failed:
    'The server rejected some values. Check the date and that weight, height and head circumference are within range.',
};

const TICKS = 4;

/** Axis bounds with a little headroom around the data and `TICKS + 1` even tick values. */
export function valueAxis(points: SeriesPoint[]): { min: number; max: number; ticks: number[] } {
  const values = points.map((p) => p.value);
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const pad = (max - min) * 0.1;
  min = Math.max(0, min - pad);
  max += pad;
  const step = (max - min) / TICKS;
  return { min, max, ticks: Array.from({ length: TICKS + 1 }, (_, i) => min + step * i) };
}
