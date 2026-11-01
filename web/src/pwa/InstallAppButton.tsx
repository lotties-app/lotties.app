import { Button, Typography } from '@mui/material';
import { useInstallPrompt } from './useInstallPrompt';

/** Renders nothing when the app is already installed or the platform cannot install it. */
export function InstallAppButton() {
  const { canInstall, showIosHint, install } = useInstallPrompt();

  if (canInstall) {
    return (
      <Button
        variant="outlined"
        size="small"
        sx={{ alignSelf: 'flex-start' }}
        onClick={() => void install()}
      >
        Install app
      </Button>
    );
  }

  if (showIosHint) {
    return (
      <Typography variant="body2" color="text.secondary">
        To install, tap Share, then Add to Home Screen.
      </Typography>
    );
  }

  return null;
}
