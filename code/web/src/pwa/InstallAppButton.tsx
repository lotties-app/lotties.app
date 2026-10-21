import { useTranslation } from 'react-i18next';
import { Button, Typography } from '@mui/material';
import { useInstallPrompt } from './useInstallPrompt';

/** Renders nothing when the app is already installed or the platform cannot install it. */
export function InstallAppButton() {
  const { t } = useTranslation();
  const { canInstall, showIosHint, install } = useInstallPrompt();

  if (canInstall) {
    return (
      <Button
        variant="outlined"
        size="small"
        sx={{ alignSelf: 'flex-start' }}
        onClick={() => void install()}
      >
        {t('pwa.install')}
      </Button>
    );
  }

  if (showIosHint) {
    return (
      <Typography variant="body2" color="text.secondary">
        {t('pwa.iosHint')}
      </Typography>
    );
  }

  return null;
}
