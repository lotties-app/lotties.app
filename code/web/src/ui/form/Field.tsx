import { useId, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, type SxProps, type Theme } from '@mui/material';
import { Icon } from '../Icon';
import type { IconName } from '../icons';
import { FieldContext, type FieldContextValue } from './fieldContext';
import { palette } from './styles';

const REQUIRED_MARK = '*';

export interface FieldProps {
  /** The visible label, always above the control (never floating). */
  label: ReactNode;
  /** A 16 px icon before the label. */
  icon?: IconName;
  /** Quiet help below the control. */
  help?: ReactNode;
  /** Error below the control; also marks the control invalid. */
  error?: ReactNode;
  /** Shows the required marker and sets `aria-required` on the control. */
  required?: boolean;
  /** Adds "· optional" to the label. */
  optional?: boolean;
  disabled?: boolean;
  /** The control is a group (radio group, chips): the label is not a `<label>` for one input. */
  group?: boolean;
  /** Id for the control; generated when absent. */
  id?: string;
  children: ReactNode;
  sx?: SxProps<Theme>;
}

/**
 * Label above, control, then help or error text. The control reads its ids through
 * `FieldContext`, so `aria-labelledby`/`aria-describedby`/`aria-invalid` are set without prop
 * plumbing. The error replaces nothing: help stays, the error is added after it.
 */
export function Field({
  label,
  icon,
  help,
  error,
  required = false,
  optional = false,
  disabled = false,
  group = false,
  id,
  children,
  sx,
}: FieldProps) {
  const { t } = useTranslation();
  const generated = useId();
  const controlId = id ?? `field-${generated}`;
  const labelId = `${controlId}-label`;
  const helpId = `${controlId}-help`;
  const errorId = `${controlId}-error`;
  const describedBy = [help ? helpId : null, error ? errorId : null].filter(Boolean).join(' ');
  const value: FieldContextValue = {
    controlId,
    labelId,
    describedBy: describedBy || undefined,
    invalid: !!error,
    required,
    disabled,
  };

  return (
    <FieldContext value={value}>
      <Box sx={[{ minWidth: 0 }, ...(Array.isArray(sx) ? sx : [sx])]}>
        <Box
          component={group ? 'span' : 'label'}
          id={labelId}
          htmlFor={group ? undefined : controlId}
          sx={(theme) => ({
            display: 'flex',
            // "· optional" goes under the label when a narrow column has no room for both.
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: 0.75,
            mb: 1,
            fontSize: '0.75rem',
            fontWeight: 500,
            lineHeight: 1.4,
            letterSpacing: '0.01em',
            color: palette(theme).text.secondary,
          })}
        >
          {icon && <Icon name={icon} size={16} />}
          <span>{label}</span>
          {required && (
            <Box component="span" aria-hidden sx={{ color: 'error.main' }}>
              {REQUIRED_MARK}
            </Box>
          )}
          {optional && !required && (
            <Box component="span" sx={{ fontWeight: 400 }}>
              {`· ${t('ui.field.optional')}`}
            </Box>
          )}
        </Box>
        {children}
        {help && (
          <Box
            id={helpId}
            sx={(theme) => ({
              mt: 0.75,
              fontSize: '0.8125rem',
              color: palette(theme).text.secondary,
            })}
          >
            {help}
          </Box>
        )}
        {error && (
          <Box
            id={errorId}
            sx={(theme) => ({
              mt: 0.75,
              display: 'flex',
              alignItems: 'center',
              gap: 0.75,
              fontSize: '0.8125rem',
              color: palette(theme).error.main,
            })}
          >
            <Icon name="error" size={16} />
            <span>{error}</span>
          </Box>
        )}
      </Box>
    </FieldContext>
  );
}
