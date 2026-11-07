import { useState } from 'react';
import { MenuItem, Stack, TextField } from '@mui/material';
import { LABEL_MAX_LENGTH } from './shownName';

const CUSTOM = '__custom__';

interface Props {
  /** The stored label: a preset code or a custom text. */
  value: string;
  presets: readonly string[];
  /** The text shown for a preset code. */
  presetText: (code: string) => string;
  label: string;
  customLabel: string;
  customOption: string;
  helperText?: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}

/** A preset list with an "Other text..." entry that reveals a free text field (names and labels, docs/design/45). */
export function LabelPicker({
  value,
  presets,
  presetText,
  label,
  customLabel,
  customOption,
  helperText,
  disabled,
  onChange,
}: Props) {
  const [custom, setCustom] = useState(value !== '' && !presets.includes(value));
  const [customText, setCustomText] = useState(custom ? value : '');
  const selected = custom ? CUSTOM : value;
  return (
    <Stack spacing={1}>
      <TextField
        select
        label={label}
        value={selected}
        disabled={disabled}
        helperText={helperText}
        onChange={(e) => {
          if (e.target.value === CUSTOM) {
            setCustom(true);
            onChange(customText);
          } else {
            setCustom(false);
            onChange(e.target.value);
          }
        }}
      >
        {presets.map((code) => (
          <MenuItem key={code} value={code}>
            {presetText(code)}
          </MenuItem>
        ))}
        <MenuItem value={CUSTOM}>{customOption}</MenuItem>
      </TextField>
      {custom && (
        <TextField
          label={customLabel}
          value={customText}
          disabled={disabled}
          slotProps={{ htmlInput: { maxLength: LABEL_MAX_LENGTH } }}
          autoComplete="off"
          onChange={(e) => {
            setCustomText(e.target.value);
            onChange(e.target.value);
          }}
        />
      )}
    </Stack>
  );
}
