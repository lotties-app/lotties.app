import type { ReactNode } from 'react';
import { Box } from '@mui/material';
import { Icon } from '../Icon';
import type { IconName } from '../icons';
import { focusRing, palette } from './styles';

export interface SwitchRowProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** The row text is the switch's accessible name. */
  label: ReactNode;
  icon?: IconName;
  description?: ReactNode;
  disabled?: boolean;
}

/**
 * A full-width row with a switch: the whole row is the control (52 px high, `role="switch"`), so
 * the label is as easy to hit as the track. The on state shows in the thumb position as well as
 * the colour.
 */
export function SwitchRow({
  checked,
  onChange,
  label,
  icon,
  description,
  disabled = false,
}: SwitchRowProps) {
  return (
    <Box
      component="button"
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      sx={(theme) => ({
        appearance: 'none',
        display: 'flex',
        alignItems: 'center',
        gap: 1.5,
        width: '100%',
        minHeight: 52,
        px: 0,
        py: 0.5,
        border: 0,
        borderRadius: '14px',
        background: 'none',
        font: 'inherit',
        color: palette(theme).text.primary,
        textAlign: 'start',
        cursor: 'pointer',
        '&:focus-visible': { outline: focusRing(theme), outlineOffset: 2 },
        '&:disabled': { opacity: 0.5, cursor: 'not-allowed' },
      })}
    >
      {icon && <Icon name={icon} size={20} sx={{ color: 'text.secondary' }} />}
      <Box component="span" sx={{ flex: 1, minWidth: 0 }}>
        <Box component="span" sx={{ display: 'block' }}>
          {label}
        </Box>
        {description && (
          <Box
            component="span"
            sx={(theme) => ({
              display: 'block',
              fontSize: '0.8125rem',
              color: palette(theme).text.secondary,
            })}
          >
            {description}
          </Box>
        )}
      </Box>
      <Box
        component="span"
        aria-hidden
        sx={(theme) => ({
          position: 'relative',
          flex: 'none',
          width: 52,
          height: 32,
          borderRadius: '999px',
          backgroundColor: checked ? palette(theme).primary.main : palette(theme).surfaceRaised,
          boxShadow: checked ? 'none' : `inset 0 0 0 1.5px ${palette(theme).text.secondary}`,
          transition: theme.transitions.create('background-color', { duration: 150 }),
          '@media (forced-colors: active)': { border: '2px solid ButtonText' },
        })}
      >
        <Box
          component="span"
          sx={(theme) => ({
            position: 'absolute',
            top: 4,
            insetInlineStart: checked ? 24 : 4,
            width: 24,
            height: 24,
            borderRadius: '50%',
            backgroundColor: checked
              ? palette(theme).primary.contrastText
              : palette(theme).text.secondary,
            transition: theme.transitions.create('inset-inline-start', { duration: 150 }),
          })}
        />
      </Box>
    </Box>
  );
}
