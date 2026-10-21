import { createContext, useContext } from 'react';

/** What a `Field` tells the control inside it, so label, help and error stay wired for assistive tech. */
export interface FieldContextValue {
  /** Id for the control (`<label htmlFor>` target). */
  controlId: string;
  /** Id of the label element (`aria-labelledby` target for groups such as segmented controls). */
  labelId: string;
  /** Ids of the help and error text, space separated (`aria-describedby`). */
  describedBy: string | undefined;
  invalid: boolean;
  required: boolean;
  disabled: boolean;
}

export const FieldContext = createContext<FieldContextValue | null>(null);

export function useFieldContext(): FieldContextValue | null {
  return useContext(FieldContext);
}

/** Attributes every single-element control (input, button) takes from its `Field`. */
export function useControlAttributes() {
  const field = useFieldContext();
  return {
    id: field?.controlId,
    'aria-describedby': field?.describedBy,
    'aria-invalid': field?.invalid ? (true as const) : undefined,
    'aria-required': field?.required ? (true as const) : undefined,
    disabled: field?.disabled ?? false,
  };
}

/** Attributes for composite controls (radio groups, groups of buttons) labelled by the field label. */
export function useGroupAttributes() {
  const field = useFieldContext();
  return {
    'aria-labelledby': field?.labelId,
    'aria-describedby': field?.describedBy,
    'aria-invalid': field?.invalid ? (true as const) : undefined,
    'aria-required': field?.required ? (true as const) : undefined,
    disabled: field?.disabled ?? false,
  };
}
