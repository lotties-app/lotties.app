import type { ErrorOverrides } from '../api/errorMessages';
import { formatNumber } from '../i18n/format';
import { t } from '../i18n/i18n';
import type { MeasurementDto, MeasurementRequest } from '../sync/contract';

export type MetricKey = 'weightKg' | 'heightCm' | 'headCircumferenceCm';

export interface MetricInfo {
  key: MetricKey;
  unit: string;
  min: number;
  max: number;
  /** Stepper increment and the value the first press starts from. */
  step: number;
  start: number;
}

/** Ranges mirror the API rules (docs/SPEC.md "Measurements"). */
export const METRICS: readonly MetricInfo[] = [
  { key: 'weightKg', unit: 'kg', min: 0.3, max: 40, step: 0.1, start: 3.5 },
  { key: 'heightCm', unit: 'cm', min: 20, max: 130, step: 0.5, start: 50 },
  { key: 'headCircumferenceCm', unit: 'cm', min: 20, max: 60, step: 0.5, start: 35 },
];

/** Localized metric name (`Weight`, `Peso`). */
export function metricLabel(metric: Pick<MetricInfo, 'key'>): string {
  return t(`growth.metrics.${metric.key}`);
}

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

  if (!form.date) errors.date = t('growth.validation.pickDate');
  else if (form.date > todayLocal(now)) errors.date = t('growth.validation.dateFuture');
  else if (form.date < MIN_DATE) errors.date = t('growth.validation.dateTooOld');

  for (const metric of METRICS) {
    const raw = form[metric.key].trim();
    if (!raw) continue;
    const n = parseNumber(raw);
    if (!Number.isFinite(n) || n < metric.min || n > metric.max) {
      errors[metric.key] = t('growth.validation.outOfRange', {
        label: metricLabel(metric),
        min: formatNumber(metric.min),
        max: formatNumber(metric.max),
        unit: metric.unit,
      });
    } else {
      values[metric.key] = Math.round(n * 100) / 100;
    }
  }
  if (!METRICS.some((m) => form[m.key].trim())) {
    errors.values = t('growth.validation.needValue');
  }
  if (form.notes.length > MAX_NOTES)
    errors.notes = t('growth.validation.notesTooLong', { max: MAX_NOTES });

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

export const MEASUREMENT_ERROR_MESSAGES: ErrorOverrides = {
  validation_failed: () => t('errors.measurementValidation'),
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
