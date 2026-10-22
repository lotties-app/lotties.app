import type { EventFieldDefinition, EventType } from '../db/models';
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
import { BottleSuggestionCaption } from './BottleSuggestionCaption';
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

function NumberControl({ type, field, value, remembered, bottle, onChange }: FieldControlProps) {
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
    >
      {field.kind === 'select' && <SelectControl {...props} />}
      {field.kind === 'number' && <NumberControl {...props} />}
      {field.kind === 'text' && (
        <TextInput value={typeof value === 'string' ? value : ''} onChange={onChange} />
      )}
    </Field>
  );
}
