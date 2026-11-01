import {
  FormControl,
  FormControlLabel,
  FormLabel,
  InputAdornment,
  MenuItem,
  Switch,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
} from '@mui/material';
import type { EventFieldDefinition } from '../db/models';

type Value = string | boolean | undefined;

interface FieldProps {
  field: EventFieldDefinition;
  value: Value;
  onChange: (value: string | boolean) => void;
}

/** Few choices (select options, or a small integer range such as 1-5) read best as big buttons. */
const MAX_BUTTON_CHOICES = 5;

function choicesFor(field: EventFieldDefinition): string[] | null {
  if (field.kind === 'select' && field.options.length <= MAX_BUTTON_CHOICES) return field.options;
  if (field.kind === 'number' && field.min !== null && field.max !== null) {
    const count = field.max - field.min + 1;
    if (Number.isInteger(count) && count > 1 && count <= MAX_BUTTON_CHOICES) {
      return Array.from({ length: count }, (_, i) => String(field.min! + i));
    }
  }
  return null;
}

function ChoiceField({ field, value, onChange, choices }: FieldProps & { choices: string[] }) {
  return (
    <FormControl required={field.isRequired}>
      <FormLabel id={`field-${field.key}`}>{field.label}</FormLabel>
      <ToggleButtonGroup
        exclusive
        fullWidth
        value={typeof value === 'string' ? value : null}
        aria-labelledby={`field-${field.key}`}
        onChange={(_, next: string | null) => onChange(next ?? '')}
      >
        {choices.map((choice) => (
          <ToggleButton key={choice} value={choice} sx={{ minHeight: 48 }}>
            {choice}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
    </FormControl>
  );
}

function BoolField({ field, value, onChange }: FieldProps) {
  return (
    <FormControlLabel
      label={field.label}
      control={<Switch checked={value === true} onChange={(_, on) => onChange(on)} />}
    />
  );
}

function InputField({ field, value, onChange }: FieldProps) {
  const isNumber = field.kind === 'number';
  const isSelect = field.kind === 'select';
  return (
    <TextField
      label={field.label}
      required={field.isRequired}
      select={isSelect}
      type={isNumber ? 'number' : 'text'}
      value={typeof value === 'string' ? value : ''}
      onChange={(e) => onChange(e.target.value)}
      slotProps={{
        htmlInput: isNumber ? { min: field.min ?? undefined, max: field.max ?? undefined } : {},
        input: field.unit
          ? { endAdornment: <InputAdornment position="end">{field.unit}</InputAdornment> }
          : {},
      }}
    >
      {isSelect &&
        field.options.map((option) => (
          <MenuItem key={option} value={option}>
            {option}
          </MenuItem>
        ))}
    </TextField>
  );
}

export function TypeField(props: FieldProps) {
  if (props.field.kind === 'bool') return <BoolField {...props} />;
  const choices = choicesFor(props.field);
  if (choices) return <ChoiceField {...props} choices={choices} />;
  return <InputField {...props} />;
}
