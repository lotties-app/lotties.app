import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, TextareaAutosize, type Theme } from '@mui/material';
import { Icon } from '../Icon';
import { useControlAttributes } from './fieldContext';
import { filledSurface, focusRing, palette, TOUCH_FIELD_FONT } from './styles';

/** Same limit as the API (`Event.Notes`). */
export const NOTES_MAX_LENGTH = 2000;
/** The character counter appears from here on. */
export const NOTES_COUNTER_FROM = 1800;

export interface NotesRowProps {
  value: string;
  onChange: (value: string) => void;
  maxLength?: number;
  counterFrom?: number;
  disabled?: boolean;
  /** Starts open even when empty (opened from a menu item, so the keyboard is expected). */
  defaultOpened?: boolean;
}

/**
 * Notes stay out of the way: a collapsed "Add a note" row that opens an auto-sizing multiline
 * field when tapped (already open when there is text). A character counter shows near the limit.
 */
export function NotesRow({
  value,
  onChange,
  maxLength = NOTES_MAX_LENGTH,
  counterFrom = NOTES_COUNTER_FROM,
  disabled: disabledProp = false,
  defaultOpened = false,
}: NotesRowProps) {
  const { t } = useTranslation();
  const { disabled: fieldDisabled, ...control } = useControlAttributes();
  const disabled = disabledProp || fieldDisabled;
  const [opened, setOpened] = useState(defaultOpened);
  const expanded = opened || value !== '';

  if (!expanded) {
    return (
      <Box
        component="button"
        type="button"
        id={control.id}
        disabled={disabled}
        aria-describedby={control['aria-describedby']}
        aria-expanded={false}
        onClick={() => setOpened(true)}
        sx={(theme) => ({
          ...filledSurface(theme),
          appearance: 'none',
          display: 'flex',
          alignItems: 'center',
          gap: 1.25,
          width: '100%',
          px: 1.75,
          border: 0,
          font: 'inherit',
          color: palette(theme).text.secondary,
          textAlign: 'start',
          cursor: 'pointer',
          '&:focus-visible': { outline: focusRing(theme), outlineOffset: 2 },
          '&:disabled': { opacity: 0.5, cursor: 'not-allowed' },
        })}
      >
        <Icon name="note" size={20} />
        <span>{t('ui.notes.add')}</span>
      </Box>
    );
  }

  return (
    <Box>
      <Box
        component={TextareaAutosize}
        id={control.id}
        aria-label={control.id ? undefined : t('ui.notes.label')}
        aria-describedby={control['aria-describedby']}
        aria-invalid={control['aria-invalid']}
        minRows={3}
        maxLength={maxLength}
        disabled={disabled}
        // Opened by a tap: the keyboard is expected, so focus moves into the field.
        autoFocus={opened && value === ''}
        value={value}
        onChange={(e: { target: { value: string } }) => onChange(e.target.value)}
        sx={(theme: Theme) => ({
          ...filledSurface(theme, !!control['aria-invalid']),
          display: 'block',
          width: '100%',
          boxSizing: 'border-box',
          p: 1.75,
          border: 0,
          font: 'inherit',
          ...TOUCH_FIELD_FONT,
          lineHeight: 1.5,
          resize: 'none',
          '&:focus-visible': { outline: focusRing(theme), outlineOffset: 0 },
          '&:disabled': { opacity: 0.5 },
        })}
      />
      {value.length >= counterFrom && (
        <Box
          role="status"
          sx={(theme) => ({
            mt: 0.5,
            textAlign: 'end',
            fontSize: '0.75rem',
            color: palette(theme).text.secondary,
          })}
        >
          {t('ui.notes.counter', { count: value.length, max: maxLength })}
        </Box>
      )}
    </Box>
  );
}
