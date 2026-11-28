import { useTranslation } from 'react-i18next';
import { Box, Button, Stack, Typography } from '@mui/material';
import type { ListenState } from '../platform/speechTypes';
import { Icon } from '../ui/Icon';

interface Props {
  /** Label of the idle button. */
  label: string;
  size: 'large' | 'normal';
  /** This control's listen is running (another one on the page may be). */
  listening: boolean;
  state: ListenState | null;
  disabled: boolean;
  onSpeak: () => void;
  onCancel: () => void;
}

/**
 * The Speak button; while listening it gives way to the listening state (text and a microphone icon,
 * announced to screen readers) and a Cancel button.
 */
export function ListenControls({
  label,
  size,
  listening,
  state,
  disabled,
  onSpeak,
  onCancel,
}: Props) {
  const { t } = useTranslation();
  const large = size === 'large';
  if (!listening) {
    return (
      <Button
        variant="contained"
        size="large"
        fullWidth={large}
        disabled={disabled}
        onClick={onSpeak}
        startIcon={<Icon name="microphone" size={large ? 32 : 24} />}
        sx={large ? { minHeight: 96, fontSize: '1.25rem' } : { alignSelf: 'flex-start' }}
      >
        {label}
      </Button>
    );
  }
  return (
    <Stack spacing={1.5} data-testid="voice-lab-listening">
      <Box
        role="status"
        aria-live="polite"
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 1.5,
          minHeight: large ? 96 : 48,
          px: 2,
          borderRadius: 2,
          border: 3,
          borderColor: 'error.main',
          color: 'error.main',
        }}
      >
        <Icon name="microphone" size={large ? 32 : 24} />
        <Typography variant={large ? 'h6' : 'body1'} component="span">
          {t(`voiceLab.state.${state ?? 'starting'}`)}
        </Typography>
      </Box>
      <Button variant="outlined" size="large" fullWidth={large} onClick={onCancel}>
        {t('voiceLab.cancel')}
      </Button>
    </Stack>
  );
}
