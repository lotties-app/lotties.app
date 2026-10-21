import { createElement } from 'react';
import { useTranslation } from 'react-i18next';
import { ButtonBase, Typography, type Theme } from '@mui/material';
import { presetIcon } from './presetIcons';
import { presetLabel } from './presetLabel';
import type { Preset } from './types';

interface Props {
  preset: Preset;
  /** Localized status line ("Last 2h ago", "Running 0:42", ...); omitted for link tiles. */
  status?: string;
  /** One of the preset's timers runs (a tap stops it). */
  running: boolean;
  disabled?: boolean;
  onClick: (preset: Preset) => void;
}

/** Category foreground token (AA on the page), or the custom type's own colour. */
function tileColor(theme: Theme, preset: Preset): string {
  if (preset.customColor) return preset.customColor;
  const categories = theme.vars?.palette.category ?? theme.palette.category;
  return categories[preset.category].fg;
}

function useActionName(preset: Preset, running: boolean): string {
  const { t } = useTranslation();
  const name = presetLabel(preset);
  if (preset.mode === 'link') return name;
  if (preset.mode === 'timer')
    return running ? t('home.stopNamed', { name }) : t('home.start', { name });
  return t('home.log', { name });
}

/** One preset: icon, name and status line. Interim tile until the wave 3 redesign. */
export function PresetTile({ preset, status, running, disabled = false, onClick }: Props) {
  const { t } = useTranslation();
  const name = presetLabel(preset);
  const action = useActionName(preset, running);
  return (
    <ButtonBase
      onClick={() => onClick(preset)}
      disabled={disabled}
      aria-label={status ? t('presets.tileLabel', { action, status }) : action}
      sx={(theme) => ({
        minHeight: 96,
        borderRadius: 2,
        border: running ? 2 : 1,
        borderColor: running ? 'primary.main' : tileColor(theme, preset),
        borderStyle: preset.mode === 'link' ? 'dashed' : 'solid',
        flexDirection: 'column',
        gap: 0.5,
        p: 1,
        textAlign: 'center',
        '&.Mui-disabled': { opacity: 0.5 },
      })}
    >
      {createElement(presetIcon(preset), {
        sx: (theme: Theme) => ({ fontSize: 36, color: tileColor(theme, preset) }),
      })}
      <Typography variant="subtitle1" component="span">
        {name}
      </Typography>
      {status && (
        <Typography
          variant="caption"
          component="span"
          color={running ? 'primary' : 'text.secondary'}
        >
          {status}
        </Typography>
      )}
    </ButtonBase>
  );
}
