import { useTranslation } from 'react-i18next';
import { ButtonBase, Box, Typography } from '@mui/material';
import { RADIUS } from '../theme/tokens';
import { Illustration } from '../ui/illustrations';
import { palette } from '../ui/form/styles';
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

function useActionName(preset: Preset, running: boolean): string {
  const { t } = useTranslation();
  const name = presetLabel(preset);
  if (preset.mode === 'link') return name;
  if (preset.mode === 'timer')
    return running ? t('home.stopNamed', { name }) : t('home.start', { name });
  return t('home.log', { name });
}

/**
 * One preset in the More sheet: a category-tinted icon, the name and a status line. A running
 * timer is marked with an accent ring and the live "Running 0:42" line (never disabled).
 */
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
        minHeight: 88,
        p: 1.5,
        gap: 1.5,
        justifyContent: 'flex-start',
        textAlign: 'left',
        borderRadius: `${RADIUS.tile}px`,
        backgroundColor: palette(theme).surfaceRaised,
        boxShadow: running ? `inset 0 0 0 2px ${palette(theme).primary.main}` : 'none',
        '&.Mui-disabled': { opacity: 0.5 },
      })}
    >
      <Illustration
        name={preset.builtIn ? preset.id : ''}
        size={48}
        fallbackIcon={presetIcon(preset)}
        fallbackCategory={preset.category}
      />
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="subtitle1" component="span" sx={{ display: 'block' }}>
          {name}
        </Typography>
        {status && (
          <Typography
            variant="caption"
            component="span"
            color={running ? 'primary' : 'text.secondary'}
            sx={{ display: 'block' }}
          >
            {status}
          </Typography>
        )}
      </Box>
    </ButtonBase>
  );
}
