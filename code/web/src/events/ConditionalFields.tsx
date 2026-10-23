import { Box, Collapse, useMediaQuery } from '@mui/material';
import type { EventFieldDefinition, EventType } from '../db/models';
import { getOwn } from '../util/ownProperty';
import type { BottleSuggestions } from './bottleSuggestions';
import type { EventFormState } from './formModel';
import { visibleFields } from './payloadRules';
import { FieldControl } from './FieldControl';
import { PREPARED_KEY } from './bottleAmounts';

interface Props {
  type: EventType;
  values: EventFormState['values'];
  /** Compact mode: only these fields and the fields they reveal. */
  only?: readonly string[];
  /** Field keys drawn elsewhere (the Sleep details section). */
  exclude?: ReadonlySet<string>;
  /** Problems by field key, shown under the fields. */
  errors?: Readonly<Record<string, string>>;
  /** Last used values by field key (quick-value chips mark them). */
  remembered?: Readonly<Record<string, string | number | boolean>>;
  /** Bottle amount chips for the `amount_ml` field (feeding only). */
  bottle?: BottleSuggestions;
  onChange: (key: string, value: string | boolean) => void;
}

/** The prepared amount typed in the form (ml), if any. */
function preparedOf(values: EventFormState['values']): number | null {
  const raw = getOwn(values, PREPARED_KEY);
  const n = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : Number.NaN;
  return Number.isFinite(n) ? n : null;
}

const BOTTLE_AMOUNT_KEY = PREPARED_KEY;

/** Whether `field` is one of `keys` or shown because of one of them (through its `visibleWhen`). */
function dependsOn(
  fields: readonly EventFieldDefinition[],
  field: EventFieldDefinition,
  keys: ReadonlySet<string>,
): boolean {
  let current: EventFieldDefinition | undefined = field;
  for (let step = 0; current && step <= fields.length; step++) {
    if (keys.has(current.key)) return true;
    const controller: string | undefined = current.visibleWhen?.field;
    current = controller ? fields.find((f) => f.key === controller) : undefined;
  }
  return false;
}

/**
 * The type's fields, honouring `visibleWhen` live: a conditional field expands when its select
 * takes one of the listed values and collapses (and is dropped from the form) otherwise. The
 * spacing sits inside the collapsing box, so it animates too; reduced motion skips the animation.
 */
export function ConditionalFields({
  type,
  values,
  only,
  exclude,
  errors,
  remembered,
  bottle,
  onChange,
}: Props) {
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const shown = new Set(visibleFields(type.fields, (key) => getOwn(values, key)).map((f) => f.key));
  const focus = only ? new Set(only) : null;
  // Hidden fields (pause keys, deprecated ones) are never drawn.
  const drawable = type.fields.filter((field) => field.hidden !== true && !exclude?.has(field.key));
  const candidates = focus
    ? drawable.filter((field) => dependsOn(type.fields, field, focus))
    : drawable;

  return candidates.map((field) => {
    const input = (
      <Box data-field-key={field.key}>
        <FieldControl
          type={type}
          field={field}
          value={getOwn(values, field.key)}
          error={errors ? getOwn(errors, field.key) : undefined}
          remembered={remembered ? getOwn(remembered, field.key) : undefined}
          {...(bottle && field.key === BOTTLE_AMOUNT_KEY ? { bottle } : {})}
          prepared={preparedOf(values)}
          onChange={(value) => onChange(field.key, value)}
        />
      </Box>
    );
    if (!field.visibleWhen) return <Box key={field.key}>{input}</Box>;
    return (
      <Collapse
        key={field.key}
        in={shown.has(field.key)}
        timeout={reducedMotion ? 0 : 'auto'}
        unmountOnExit
        sx={{ '&&': { mt: 0 } }}
      >
        <Box sx={{ pt: 2 }}>{input}</Box>
      </Collapse>
    );
  });
}
