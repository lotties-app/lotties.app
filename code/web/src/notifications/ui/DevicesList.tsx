import { useTranslation } from 'react-i18next';
import { Button, List, ListItem, ListItemText, Stack, Typography } from '@mui/material';
import { useApiClient } from '../../api/ApiClientContext';
import { formatDate } from '../../i18n/format';
import { ErrorNotice } from '../../settings/ErrorNotice';
import { useServerAction } from '../../settings/useServerAction';
import { revokePushDevice, type PushDeviceDto } from '../pushApi';
import { useRefreshPush } from '../usePush';

/**
 * The caller's devices with notifications on. This device is marked and turned off with its
 * switch; the others have Remove (revokes on the server).
 */
export function DevicesList({
  devices,
  currentId,
  online,
}: {
  devices: readonly PushDeviceDto[];
  currentId: string | null;
  online: boolean;
}) {
  const { t } = useTranslation();
  const api = useApiClient();
  const refresh = useRefreshPush();
  const remove = useServerAction();

  return (
    <Stack spacing={1}>
      <Typography variant="subtitle1" component="h3">
        {t('notifications.devices.heading')}
      </Typography>
      {devices.length === 0 ? (
        <Typography color="text.secondary">{t('notifications.devices.empty')}</Typography>
      ) : (
        <List aria-label={t('notifications.devices.heading')} disablePadding>
          {devices.map((device) => {
            const label = device.deviceLabel ?? t('notifications.devices.unnamed');
            const current = device.id === currentId;
            const added = t('notifications.devices.added', {
              date: formatDate(device.createdAt),
            });
            return (
              <ListItem key={device.id} divider sx={{ gap: 1, px: 0 }}>
                <ListItemText
                  primary={label}
                  secondary={
                    current ? `${t('notifications.devices.thisDevice')} · ${added}` : added
                  }
                />
                {!current && (
                  <Button
                    size="small"
                    color="error"
                    disabled={!online || remove.pending}
                    aria-label={t('notifications.devices.removeNamed', { label })}
                    onClick={() =>
                      void remove.run(async () => {
                        await revokePushDevice(api, device.id);
                        await refresh();
                      })
                    }
                  >
                    {t('notifications.devices.remove')}
                  </Button>
                )}
              </ListItem>
            );
          })}
        </List>
      )}
      <ErrorNotice message={remove.error} />
    </Stack>
  );
}
