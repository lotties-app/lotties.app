import { useTranslation } from 'react-i18next';
import { Outlet } from 'react-router-dom';
import { Box, CircularProgress } from '@mui/material';
import { ConsentScreen } from './ConsentScreen';
import { useConsent } from './ConsentContext';

/**
 * A layout route between the auth guard and the app (docs/design/38-consent-and-terms.md section 5): while the account has no
 * current core consent, every route below it shows the consent screen instead (at the same address, so an invite link or a
 * bookmark carries on after she accepts). Nothing below mounts meanwhile: no baby screen, no shell, no reminders, no sync
 * (`ConsentProvider` tells the sync engine). The routes outside it (the public pages, the project board) do not need a consent.
 */
export function ConsentGate() {
  const { t } = useTranslation();
  const { status } = useConsent();
  if (status === 'checking') {
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', minHeight: '100dvh' }}>
        <CircularProgress aria-label={t('common.loading')} />
      </Box>
    );
  }
  if (status === 'required') return <ConsentScreen />;
  return <Outlet />;
}
