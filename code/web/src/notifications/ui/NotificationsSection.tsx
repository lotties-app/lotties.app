import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Box, CircularProgress, Divider, Stack, Typography } from '@mui/material';
import { describeApiError } from '../../api/errorMessages';
import type { Baby } from '../../db/models';
import { ErrorNotice } from '../../settings/ErrorNotice';
import { useOnline } from '../../sync/useOnline';
import {
  useBabyPreferences,
  useNotificationSettings,
  usePushDevices,
  useThisDevice,
} from '../usePush';
import { BabyReminders } from './BabyReminders';
import { DeviceBlock } from './DeviceBlock';
import { DevicesList } from './DevicesList';
import { GeneralSettings } from './GeneralSettings';
import { PushNote } from './PushNote';

interface Props {
  /** The babies the user belongs to (Viewer rows are shown disabled). */
  babies: readonly Baby[];
  /** The server's VAPID key from `GET /push/config` (the section is shown only when push is on). */
  publicKey: string;
  /** Overrides the browser's online flag (developer preview). */
  online?: boolean;
}

/**
 * Settings > Notifications (docs/design/09-push-notifications.md section 11): this device, per-baby
 * reminders, quiet hours, show names, time zone and the devices list. Online-only server state:
 * offline it shows the last loaded values read-only.
 */
export function NotificationsSection({ babies, publicKey, online: onlineOverride }: Props) {
  const { t } = useTranslation();
  const browserOnline = useOnline();
  const online = onlineOverride ?? browserOnline;
  const [announcement, setAnnouncement] = useState('');
  const settings = useNotificationSettings(true);
  const preferences = useBabyPreferences(true);
  const devices = usePushDevices(true);
  const thisDevice = useThisDevice(true);

  const failed = settings.error ?? preferences.error ?? devices.error;
  const loading = !settings.data || !preferences.data || !devices.data;

  return (
    <Stack spacing={2.5}>
      <Typography color="text.secondary">{t('notifications.intro')}</Typography>
      <PushNote>{t('notifications.guardrail')}</PushNote>
      <PushNote>{t('notifications.syncedOnly')}</PushNote>
      {!online && <Alert severity="info">{t('notifications.offline')}</Alert>}
      <DeviceBlock
        publicKey={publicKey}
        thisDevice={thisDevice.data}
        online={online}
        announce={setAnnouncement}
      />
      <Box role="status" aria-live="polite" sx={visuallyHidden}>
        {announcement}
      </Box>
      {loading ? (
        failed ? (
          <ErrorNotice message={describeApiError(failed)} />
        ) : online ? (
          <CircularProgress aria-label={t('common.loading')} />
        ) : null
      ) : (
        <>
          <Divider />
          <BabyReminders babies={babies} preferences={preferences.data} online={online} />
          <Divider />
          <GeneralSettings
            // Server times replace the draft fields when they change.
            key={`${settings.data.quietHours.start}-${settings.data.quietHours.end}`}
            settings={settings.data}
            online={online}
          />
          <Divider />
          <DevicesList
            devices={devices.data}
            currentId={thisDevice.data?.subscriptionId ?? null}
            online={online}
          />
        </>
      )}
    </Stack>
  );
}

/** Announced to screen readers, not shown (the switch itself shows the state). */
const visuallyHidden = {
  position: 'absolute',
  width: 1,
  height: 1,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
} as const;
