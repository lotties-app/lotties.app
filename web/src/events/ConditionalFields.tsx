import { Box, Collapse, useMediaQuery } from '@mui/material';
import type { EventFieldDefinition, EventType } from '../db/models';
import { getOwn } from '../util/ownProperty';
import type { EventFormState } from './formModel';
import { visibleFields } from './payloadRules';
import { TypeField } from './TypeFields';

interface Props {
  type: EventType;
  values: EventFormState['values'];
  /** Compact mode: only these fields and the fields they reveal. */
  only?: readonly string[];
  onChange: (key: string, value: string | boolean) => void;
}

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
export function ConditionalFields({ type, values, only, onChange }: Props) {
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const shown = new Set(visibleFields(type.fields, (key) => getOwn(values, key)).map((f) => f.key));
  const focus = only ? new Set(only) : null;
  const candidates = focus
    ? type.fields.filter((field) => dependsOn(type.fields, field, focus))
    : type.fields;

  return candidates.map((field) => {
    const input = (
      <TypeField
        type={type}
        field={field}
        value={getOwn(values, field.key)}
        onChange={(value) => onChange(field.key, value)}
      />
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
