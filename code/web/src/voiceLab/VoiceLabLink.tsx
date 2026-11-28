import { useTranslation } from 'react-i18next';
import { Link as RouterLink } from 'react-router-dom';
import { Link, Stack, Typography } from '@mui/material';

/**
 * Settings > Voice assistants: the line to the voice lab. Rendered only in a build with VITE_VOICE_LAB
 * (SettingsPage imports it lazily behind that constant, so other builds hold none of it).
 */
export default function VoiceLabLink() {
  const { t } = useTranslation();
  return (
    <Stack spacing={0.5} data-testid="voice-lab-link">
      <Link
        component={RouterLink}
        to="/lab/voice"
        sx={{
          alignSelf: 'flex-start',
          minHeight: 44,
          display: 'inline-flex',
          alignItems: 'center',
        }}
      >
        {t('voiceLab.link')}
      </Link>
      <Typography variant="body2" color="text.secondary">
        {t('voiceLab.linkHint')}
      </Typography>
    </Stack>
  );
}
