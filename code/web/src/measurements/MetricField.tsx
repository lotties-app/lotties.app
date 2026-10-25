import { useTranslation } from 'react-i18next';
import { formatNumber } from '../i18n/format';
import { Field } from '../ui/form/Field';
import { NumberStepper } from '../ui/form/NumberStepper';
import { parseLocaleNumber } from '../ui/form/numbers';
import { kgToLbOz, lbOzToKg } from '../units/convert';
import { QuantityStepper } from '../units/QuantityStepper';
import { useUnits } from '../units/useUnits';
import { metricLabel, metricText, type MetricInfo } from './measurementModel';

interface Props {
  metric: MetricInfo;
  /** The stored (metric) value as text; `''` when empty. */
  value: string;
  error?: string | undefined;
  onChange: (value: string) => void;
}

/** US pounds field: a baby above this is out of the measurement range anyway (40 kg). */
const MAX_POUNDS = 90;
const MAX_OUNCES = 15;
/** Where the first press starts (7 lb 11 oz is a typical newborn). */
const START_POUNDS = 7;

/**
 * One growth value in the person's units. Metric: a stepper in kg or cm. US customary: weight as
 * two fields (pounds, ounces) and lengths in inches. The text in `value` stays metric: it changes
 * only when the person edits a field, never because the form was shown.
 */
export function MetricField({ metric, value, error, onChange }: Props) {
  const { t } = useTranslation();
  const units = useUnits();
  const label = metricLabel(metric);
  const stored = parseLocaleNumber(value);
  const help = error
    ? undefined
    : units.system === 'us'
      ? t('units.range', {
          min: metricText(metric, metric.min),
          max: metricText(metric, metric.max),
        })
      : t('growth.range', {
          min: formatNumber(metric.min),
          max: formatNumber(metric.max),
          unit: metric.unit,
        });

  if (units.system === 'us' && metric.key === 'weightKg') {
    const parts = stored === null ? null : kgToLbOz(stored);
    const set = (lb: number | null, oz: number | null) =>
      onChange(lb === null && oz === null ? '' : String(lbOzToKg(lb ?? 0, oz ?? 0)));
    return (
      <>
        <Field label={t('units.field.pounds', { label })} error={error} help={help}>
          <NumberStepper
            value={parts?.lb ?? null}
            onChange={(next) => set(next, parts?.oz ?? null)}
            step={1}
            decimals={0}
            min={0}
            max={MAX_POUNDS}
            start={START_POUNDS}
            unit="lb"
          />
        </Field>
        <Field label={t('units.field.ounces', { label })}>
          <NumberStepper
            value={parts?.oz ?? null}
            onChange={(next) => set(parts?.lb ?? null, next)}
            step={1}
            decimals={0}
            min={0}
            max={MAX_OUNCES}
            start={0}
            unit="oz"
          />
        </Field>
      </>
    );
  }

  const unit = units.system === 'us' ? units.labels.length : metric.unit;
  return (
    <Field label={t('growth.metricLabel', { label, unit })} error={error} help={help}>
      {metric.key === 'weightKg' ? (
        <NumberStepper
          value={stored}
          onChange={(next) => onChange(next === null ? '' : String(next))}
          step={metric.step}
          start={metric.start}
          unit={metric.unit}
        />
      ) : (
        <QuantityStepper
          quantity="length"
          value={stored}
          onChange={(next) => onChange(next === null ? '' : String(next))}
          step={metric.step}
          start={metric.start}
          unit={metric.unit}
        />
      )}
    </Field>
  );
}
