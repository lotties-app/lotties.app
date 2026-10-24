import { useTranslation } from 'react-i18next';
import { Link as RouterLink, Navigate } from 'react-router-dom';
import { Alert, Button, CircularProgress, Stack, Typography } from '@mui/material';
import { canLog } from '../baby/permissions';
import { useSelectedBaby } from '../baby/SelectedBabyContext';
import { useEventTypes } from '../db/hooks';
import { isNativeApp } from '../platform/nativeApp';
import { Icon } from '../ui/Icon';
import { CryMonitorScreen, type CryMonitorScreenProps } from './CryMonitorScreen';

/*
 * Hub > App > Cry monitor (beta), route `/hub/cry-monitor` (docs/design/35-cry-engine.md section 8): a
 * lazily loaded chunk; the engine itself loads only when "Start monitoring" is pressed. Owners, Parents
 * and Caregivers of the selected baby (the roles that log); a Viewer or the Doctor, and the native app
 * (monitor mode is web only for now), go back to the Hub.
 */
export default function CryMonitorPage(props: Omit<CryMonitorScreenProps, 'baby' | 'types'> = {}) {
  const { t } = useTranslation();
  const { babies, baby } = useSelectedBaby();
  const types = useEventTypes(baby?.id ?? '');
  if (isNativeApp() || (babies && baby && !canLog(baby))) return <Navigate to="/hub" replace />;
  return (
    <Stack spacing={2}>
      <Button
        component={RouterLink}
        to="/hub"
        startIcon={<Icon name="arrow-left" size={20} />}
        sx={{ alignSelf: 'flex-start', minHeight: 44 }}
      >
        {t('hub.back')}
      </Button>
      <Typography variant="h5" component="h1">
        {t('cryMonitor.title')}
      </Typography>
      {!babies || (baby && !types) ? (
        <CircularProgress aria-label={t('common.loading')} />
      ) : baby && types ? (
        <CryMonitorScreen key={baby.id} baby={baby} types={types} {...props} />
      ) : (
        <Alert severity="info">{t('settings.createBabyFirst')}</Alert>
      )}
    </Stack>
  );
}
