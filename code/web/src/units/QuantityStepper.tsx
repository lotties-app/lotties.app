import { NumberStepper, type NumberStepperProps } from '../ui/form/NumberStepper';
import { cToF, cmToIn, fToC, flOzToMl, inToCm, mlToFlOz, roundDisplay } from './convert';
import { useUnits } from './useUnits';

export type SteppedQuantity = 'volume' | 'temperature' | 'length';

/** How a quantity is stepped and typed in US customary units (the stored value is metric). */
interface UsRules {
  /** Canonical metric value -> the number shown (1 decimal). */
  toDisplay: (canonical: number) => number;
  /** The number typed or stepped -> the canonical metric value (whole ml / 0.1 C). */
  toCanonical: (shown: number) => number;
  step: number;
  decimals: number;
  /** The suffix; `null`: the language's word for inches (`in`, `pol.`). */
  unit: string | null;
  /** Preset chips sit on this grid (fl oz: halves). */
  chipGrid: number;
}

const US_RULES: Record<SteppedQuantity, UsRules> = {
  volume: {
    toDisplay: (ml) => roundDisplay(mlToFlOz(ml), 1),
    toCanonical: flOzToMl,
    step: 0.5,
    decimals: 1,
    unit: 'fl oz',
    chipGrid: 0.5,
  },
  temperature: {
    toDisplay: (c) => roundDisplay(cToF(c), 1),
    toCanonical: fToC,
    step: 0.2,
    decimals: 1,
    unit: '°F',
    chipGrid: 0.1,
  },
  length: {
    toDisplay: (cm) => roundDisplay(cmToIn(cm), 1),
    toCanonical: inToCm,
    step: 0.5,
    decimals: 1,
    unit: null,
    chipGrid: 0.5,
  },
};

export interface QuantityStepperProps extends Omit<NumberStepperProps, 'unit'> {
  /** What the number measures (`null`: another unit, left alone). */
  quantity: SteppedQuantity | null;
  /** Metric suffix (`ml`, `°C`). */
  unit?: string;
}

const snap = (value: number, grid: number) => roundDisplay(Math.round(value / grid) * grid, 2);

/**
 * `NumberStepper` for a value stored in metric (ml, degrees C). Metric: the stepper unchanged. US
 * customary: it shows and steps fluid ounces (halves) or degrees Fahrenheit, with presets on the
 * same grid, and hands back the canonical metric number (whole ml, 0.1 C) only when the person
 * changes it: showing a stored value never rewrites it. Limits are canonical and are applied
 * after the conversion.
 */
export function QuantityStepper({
  quantity,
  value,
  onChange,
  step,
  min,
  max,
  decimals,
  unit,
  quickValues,
  quickTags,
  lastValue,
  start,
  ...rest
}: QuantityStepperProps) {
  const { system, labels } = useUnits();
  if (system !== 'us' || quantity === null) {
    return (
      <NumberStepper
        {...rest}
        value={value}
        onChange={onChange}
        {...(step !== undefined ? { step } : {})}
        {...(min !== undefined ? { min } : {})}
        {...(max !== undefined ? { max } : {})}
        {...(decimals !== undefined ? { decimals } : {})}
        {...(unit !== undefined ? { unit } : {})}
        {...(quickValues ? { quickValues } : {})}
        {...(quickTags ? { quickTags } : {})}
        {...(lastValue !== undefined ? { lastValue } : {})}
        {...(start !== undefined ? { start } : {})}
      />
    );
  }

  const rules = US_RULES[quantity];
  const clampCanonical = (canonical: number) =>
    Math.min(max ?? Infinity, Math.max(min ?? -Infinity, canonical));

  // Presets: the canonical ones snapped onto the grid, each once; the tag follows its snapped value.
  const chips: number[] = [];
  const tags: Record<number, string> = {};
  for (const canonical of quickValues ?? []) {
    const shown = snap(rules.toDisplay(canonical), rules.chipGrid);
    if (shown <= 0 || chips.includes(shown)) continue;
    chips.push(shown);
    if (quickTags && Object.hasOwn(quickTags, canonical)) tags[shown] = quickTags[canonical]!;
  }
  // "last" is offered only when the display value maps back to exactly that number.
  const lastShown =
    lastValue !== null &&
    lastValue !== undefined &&
    rules.toCanonical(rules.toDisplay(lastValue)) === lastValue
      ? rules.toDisplay(lastValue)
      : null;

  return (
    <NumberStepper
      {...rest}
      value={value === null ? null : rules.toDisplay(value)}
      onChange={(shown) =>
        onChange(shown === null ? null : clampCanonical(rules.toCanonical(shown)))
      }
      step={rules.step}
      decimals={rules.decimals}
      unit={rules.unit ?? labels.length}
      {...(min !== undefined
        ? { min: roundDisplay(Math.ceil(rules.toDisplay(min) * 10) / 10, 1) }
        : {})}
      {...(max !== undefined
        ? { max: roundDisplay(Math.floor(rules.toDisplay(max) * 10) / 10, 1) }
        : {})}
      {...(quickValues ? { quickValues: chips, quickTags: tags } : {})}
      lastValue={lastShown}
      {...(start !== undefined ? { start: rules.toDisplay(start) } : {})}
    />
  );
}
