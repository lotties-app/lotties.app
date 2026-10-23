import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Stack, Typography } from '@mui/material';
import { Icon } from '../ui/Icon';
import { InstallGuideSheet } from './InstallGuideSheet';
import { useInstallState } from './useInstallState';

type Status = 'accepted' | 'dismissed' | null;

/**
 * The one install button (landing page, Hub > Install the app, top of /install, Settings).
 * - The browser offered its prompt (Chrome, Edge, Samsung Internet on Android and desktop): "Install
 *   app" opens the browser's own install dialog; `appinstalled` then hides the button.
 * - No prompt (iPhone and iPad: Apple has no API for it; Firefox; a prompt already used): the button
 *   opens the short guide for this browser. On iOS it says "Add to Home Screen", never "Install":
 *   the person does the last taps in Safari.
 * - Already installed, or inside the store app: nothing.
 */
export function InstallButton({ showFullGuideLink = true }: { showFullGuideLink?: boolean }) {
  const { t } = useTranslation();
  const state = useInstallState();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Status>(null);

  if (state.native) return null;
  const statusText =
    status === 'accepted'
      ? t('install.button.accepted')
      : status === 'dismissed'
        ? t('install.button.dismissed')
        : '';
  const live = (
    <Typography aria-live="polite" variant="body2" color="text.secondary">
      {statusText}
    </Typography>
  );
  if (state.installed) return status === 'accepted' ? live : null;

  const onClick = async () => {
    if (!state.canPrompt) {
      setOpen(true);
      return;
    }
    const outcome = await state.install();
    if (outcome === 'unavailable') setOpen(true);
    else setStatus(outcome);
  };
  const label = state.canPrompt
    ? t('install.button.install')
    : state.platform.os === 'ios'
      ? t('install.button.addToHomeScreen')
      : t('install.button.howTo');

  return (
    <Stack spacing={1} sx={{ alignItems: 'flex-start' }}>
      <Button
        variant="contained"
        onClick={() => void onClick()}
        aria-haspopup={state.canPrompt ? undefined : 'dialog'}
        startIcon={<Icon name="download" size={20} />}
        sx={{ minHeight: 48 }}
      >
        {label}
      </Button>
      {live}
      <InstallGuideSheet
        open={open}
        onClose={() => setOpen(false)}
        guide={state.guide}
        platform={state.platform}
        showFullGuideLink={showFullGuideLink}
      />
    </Stack>
  );
}
