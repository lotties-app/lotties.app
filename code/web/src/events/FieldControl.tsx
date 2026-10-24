import type { EventFieldDefinition, EventType } from '../db/models';
import { useTranslation } from 'react-i18next';
import { useEventTypeText } from '../i18n/eventTypeText';
import {
  ChipGroup,
  DurationField,
  Field,
  NumberStepper,
  SegmentedControl,
  SwitchRow,
  TextInput,
} from '../ui/form';
import { Box, Typography } from '@mui/material';
import { FieldContext } from '../ui/form/fieldContext';
import { BottleLevelChips } from './BottleLevelChips';
import { BottleSuggestionCaption } from './BottleSuggestionCaption';
import { DRUNK_KEY, drunkChoices, type DrunkShare } from './bottleAmounts';
import type { BottleSuggestions } from './bottleSuggestions';
import { optionIcon } from './optionIcons';

export type FieldValue = string | boolean | undefined;

export interface FieldControlProps {
  type: EventType;
  field: EventFieldDefinition;
  value: FieldValue;
  /** Problem shown under the field. */
  error?: string;
  /** The last used value of the field (per baby and type), if any. */
  remembered?: string | number | boolean;
  /** Bottle amount chips that follow the baby (the feeding `amount_ml` field only). */
  bottle?: BottleSuggestions;
  /** What was prepared (ml): the drunk amount's quick choices and ceiling (feeding `amount_drunk_ml`). */
  prepared?: number | null;
  /**
   * Stopping a timed bottle: "left in the bottle" chips under the drunk amount, none above this
   * level (`null`: unknown, up to the prepared amount). Absent: no such chips.
   */
  leftCeiling?: number | null;
  onChange: (value: string | boolean) => void;
}

/** Up to this many options read best as a segmented control; more wrap as chips. */
export const SEGMENTED_MAX_OPTIONS = 4;
/** A small integer range (a 1-5 scale) is a choice, not a number to step. */
const SCALE_MAX_CHOICES = 5;
const DEGREES_C = '°C';
const ML_QUICK_VALUES = [60, 90, 120, 150] as const;
/**
 * First value of an empty stepper (+ or -) of the built-in temperature reading, so it does not
 * start at the 30 °C minimum. Only a starting point: the range, the decimals and the way the
 * reading is shown are unchanged, and nothing judges the value.
 */
const TEMPERATURE_STEPPER_START = 36.5;

/** The first stepper value of a field when it has its own (`undefined`: the generic rules). */
function ownStepperStart(type: EventType, field: EventFieldDefinition): number | undefined {
  const isTemperatureReading =
    type.babyId === null && type.key === 'temperature' && field.key === 'value_c';
  return isTemperatureReading ? TEMPERATURE_STEPPER_START : undefined;
}

const isSeconds = (field: EventFieldDefinition) =>
  field.kind === 'number' && (field.unit === 's' || field.key.endsWith('_seconds'));

function scaleChoices(field: EventFieldDefinition): string[] | null {
  if (field.kind !== 'number' || field.min === null || field.max === null) return null;
  const count = field.max - field.min + 1;
  if (!Number.isInteger(count) || count < 2 || count > SCALE_MAX_CHOICES) return null;
  return Array.from({ length: count }, (_, i) => String(field.min! + i));
}

const toNumber = (value: FieldValue): number | null => {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

/** Display form of a stored unit (`C` is degrees Celsius). */
const unitLabel = (unit: string): string => (unit === 'C' ? DEGREES_C : unit);

function stepFor(field: EventFieldDefinition): number {
  if (field.integer === true) return 1;
  // One step of the last allowed decimal place (a temperature with one decimal steps by 0.1).
  if (field.decimals !== undefined) return 10 ** -field.decimals;
  if (field.unit === 'ml') return 10;
  if (field.unit === 'C' || field.unit === '°C') return 0.5;
  return 1;
}

function SelectControl({ type, field, value, onChange }: FieldControlProps) {
  const text = useEventTypeText();
  const current = typeof value === 'string' && value !== '' ? value : null;
  const options = field.options.map((option) => ({
    value: option,
    label: text.optionLabel(type, field, option),
    icon: optionIcon(type, field, option),
  }));
  if (options.length <= SEGMENTED_MAX_OPTIONS) {
    return (
      <SegmentedControl
        value={current}
        options={options}
        clearable={!field.isRequired}
        onChange={(next) => onChange(next ?? '')}
      />
    );
  }
  return (
    <ChipGroup
      value={current}
      options={options}
      clearable={!field.isRequired}
      onChange={(next) => onChange(next ?? '')}
    />
  );
}

const isDrunkAmount = (type: EventType, field: EventFieldDefinition) =>
  type.babyId === null && type.key === 'feeding' && field.key === DRUNK_KEY;

const SHARE_KEY = {
  all: 'feedingAmounts.share.all',
  threeQuarters: 'feedingAmounts.share.threeQuarters',
  half: 'feedingAmounts.share.half',
  quarter: 'feedingAmounts.share.quarter',
} as const satisfies Record<DrunkShare, string>;

/**
 * The drunk amount of a bottle: chips for all, 3/4, half and 1/4 of what was prepared, plus free
 * entry; when stopping a timed bottle, also "left in the bottle" chips that fill it as prepared
 * minus the level (so the total and the drinking stretches agree).
 */
function DrunkControl({ field, value, prepared, leftCeiling, onChange }: FieldControlProps) {
  const { t } = useTranslation();
  const max = prepared != null && prepared > 0 ? prepared : (field.max ?? undefined);
  const drunk = toNumber(value);
  const made = prepared != null && prepared > 0 ? prepared : null;
  return (
    <>
      {leftCeiling !== undefined && made !== null && (
        <Box sx={{ mb: 1.5 }}>
          <Typography variant="overline" component="p" color="text.secondary">
            {t('feedingAmounts.level.leftAtStop')}
          </Typography>
          {/* Its own group, named by its own heading (not by the field's label). */}
          <FieldContext.Provider value={null}>
            <BottleLevelChips
              aria-label={t('feedingAmounts.level.leftAtStop')}
              preparedMl={made}
              ceilingMl={leftCeiling}
              value={Math.max(0, made - (drunk ?? made))}
              onChange={(leftMl) => onChange(String(Math.max(0, made - leftMl)))}
            />
          </FieldContext.Provider>
        </Box>
      )}
      <DrunkStepper field={field} value={value} max={max} prepared={prepared} onChange={onChange} />
    </>
  );
}

function DrunkStepper({
  field,
  value,
  max,
  prepared,
  onChange,
}: Pick<FieldControlProps, 'field' | 'value' | 'prepared' | 'onChange'> & {
  max: number | undefined;
}) {
  const { t } = useTranslation();
  const choices = drunkChoices(prepared);
  return (
    <NumberStepper
      value={toNumber(value)}
      onChange={(next) => onChange(next === null ? '' : String(next))}
      step={stepFor(field)}
      min={field.min ?? 0}
      {...(max !== undefined ? { max } : {})}
      unit={unitLabel(field.unit ?? 'ml')}
      quickValues={choices.map((choice) => choice.ml)}
      quickTags={Object.fromEntries(
        choices.map((choice) => [choice.ml, t(SHARE_KEY[choice.share])]),
      )}
      {...(prepared != null && prepared > 0 ? { start: prepared } : {})}
    />
  );
}

function NumberControl({
  type,
  field,
  value,
  remembered,
  bottle,
  onChange,
  ...rest
}: FieldControlProps) {
  if (isDrunkAmount(type, field)) {
    return <DrunkControl type={type} field={field} value={value} onChange={onChange} {...rest} />;
  }
  const choices = scaleChoices(field);
  if (choices) {
    return (
      <ChipGroup
        value={typeof value === 'string' && value !== '' ? value : null}
        options={choices.map((choice) => ({ value: choice, label: choice }))}
        clearable={!field.isRequired}
        onChange={(next) => onChange(next ?? '')}
      />
    );
  }
  if (isSeconds(field)) {
    return (
      <DurationField
        valueSeconds={toNumber(value)}
        maxSeconds={field.max ?? undefined}
        onChange={(seconds) => onChange(seconds === null ? '' : String(seconds))}
      />
    );
  }
  const last = typeof remembered === 'number' ? remembered : null;
  const inRange = (n: number) =>
    (field.max === null || n <= field.max) && (field.min === null || n >= field.min);
  const quick = bottle
    ? bottle.amounts.filter(inRange)
    : field.unit === 'ml'
      ? ML_QUICK_VALUES.filter(inRange)
      : undefined;
  const ownStart = ownStepperStart(type, field);
  const start = bottle ? bottle.preferred : 90;
  return (
    <>
      <NumberStepper
        value={toNumber(value)}
        onChange={(next) => onChange(next === null ? '' : String(next))}
        step={bottle ? bottle.step : stepFor(field)}
        {...(field.integer === true ? { decimals: 0 } : {})}
        {...(field.decimals !== undefined ? { decimals: field.decimals } : {})}
        {...(field.min !== null ? { min: field.min } : {})}
        {...(field.max !== null ? { max: field.max } : {})}
        {...(field.unit ? { unit: unitLabel(field.unit) } : {})}
        {...(quick ? { quickValues: quick } : {})}
        lastValue={last}
        {...(ownStart !== undefined
          ? { start: ownStart }
          : last === null && (bottle || field.unit === 'ml')
            ? { start }
            : {})}
      />
      {bottle && <BottleSuggestionCaption suggestions={bottle} />}
    </>
  );
}

/**
 * One field of an event type as the matching control of the form library: segmented control with
 * icons for up to four options, chips for more, a stepper (with quick values) for numbers, a
 * minutes field for `*_seconds`, a switch row for yes/no, one line for text. Label above, error
 * below; the control reads its ids from the `Field`.
 */
export function FieldControl(props: FieldControlProps) {
  const { type, field, value, error, onChange } = props;
  const text = useEventTypeText();
  const { t } = useTranslation();
  const label = text.fieldLabel(type, field);
  if (field.kind === 'bool') {
    return <SwitchRow label={label} checked={value === true} onChange={onChange} />;
  }
  const group = field.kind === 'select' || scaleChoices(field) !== null;
  return (
    <Field
      label={label}
      group={group}
      required={field.isRequired}
      optional={!field.isRequired}
      error={error}
      {...(isDrunkAmount(type, field) ? { help: t('feedingAmounts.drunkHint') } : {})}
    >
      {field.kind === 'select' && <SelectControl {...props} />}
      {field.kind === 'number' && <NumberControl {...props} />}
      {field.kind === 'text' && (
        <TextInput value={typeof value === 'string' ? value : ''} onChange={onChange} />
      )}
    </Field>
  );
}
