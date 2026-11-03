import { useTranslation } from 'react-i18next';
import { Link as RouterLink } from 'react-router-dom';
import { Link, Stack, Typography } from '@mui/material';

/** Settings > Voice assistants: the way to the Voice commands page (works offline: static content). */
export function VoiceCommandsLink() {
  const { t } = useTranslation();
  return (
    <Stack spacing={0.5}>
      <Link
        component={RouterLink}
        to="/settings/voice-commands"
        sx={{ alignSelf: 'flex-start', minHeight: 44, display: 'inline-flex', alignItems: 'center' }}
      >
        {t('voiceCommands.open')}
      </Link>
      <Typography variant="body2" color="text.secondary">
        {t('voiceCommands.openHint')}
      </Typography>
    </Stack>
  );
}
