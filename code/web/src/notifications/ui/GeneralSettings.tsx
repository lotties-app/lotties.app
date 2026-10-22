import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { Box, Stack, Typography } from '@mui/material';
import { useApiClient } from '../../api/ApiClientContext';
import { ErrorNotice } from '../../settings/ErrorNotice';
import { useServerAction } from '../../settings/useServerAction';
import { ClockTimeField, Field, SwitchRow } from '../../ui/form';
import { putNotificationSettings, type NotificationSettingsDto } from '../pushApi';
import { usePushDevice } from '../PushDeviceContext';
import { pushKeys } from '../usePush';

/** Quiet hours, show names and the time zone line: the user's settings for every baby. */
export function GeneralSettings({
  settings,
  online,
}: {
  settings: NotificationSettingsDto;
  online: boolean;
}) {
  const { t } = useTranslation();
  const api = useApiClient();
  const device = usePushDevice();
  const queryClient = useQueryClient();
  const save = useServerAction();
  const [draft, setDraft] = useState({
    start: settings.quietHours.start,
    end: settings.quietHours.end,
  });
  const [sameTime, setSameTime] = useState(false);
  const off = !online || save.pending;
  const zone = settings.timeZone ?? device.timeZone();

  const store = (next: NotificationSettingsDto) => {
    const previous = settings;
    queryClient.setQueryData(pushKeys.settings, next);
    void save.run(async () => {
      try {
        const stored = await putNotificationSettings(api, { ...next, timeZone: zone });
        queryClient.setQueryData(pushKeys.settings, stored);
      } catch (e) {
        queryClient.setQueryData(pushKeys.settings, previous);
        throw e;
      }
    });
  };

  const commitTimes = () => {
    const { start, end } = draft;
    if (!start || !end) return;
    if (start === end) {
      setSameTime(true);
      return;
    }
    setSameTime(false);
    if (start === settings.quietHours.start && end === settings.quietHours.end) return;
    store({ ...settings, quietHours: { ...settings.quietHours, start, end } });
  };

  const quiet = settings.quietHours;
  return (
    <Stack spacing={1.5}>
      <SwitchRow
        icon="moon"
        checked={quiet.enabled}
        disabled={off}
        onChange={(enabled) => store({ ...settings, quietHours: { ...quiet, enabled } })}
        label={t('notifications.quiet.switch')}
        description={t('notifications.quiet.help')}
      />
      {quiet.enabled && (
        <>
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5 }}>
            <Field
              label={t('notifications.quiet.start')}
              disabled={off}
              error={sameTime ? t('notifications.quiet.sameTime') : undefined}
            >
              <ClockTimeField
                value={draft.start}
                onChange={(start) => setDraft((d) => ({ ...d, start }))}
                onBlur={commitTimes}
              />
            </Field>
            <Field label={t('notifications.quiet.end')} disabled={off}>
              <ClockTimeField
                value={draft.end}
                onChange={(end) => setDraft((d) => ({ ...d, end }))}
                onBlur={commitTimes}
              />
            </Field>
          </Box>
          <SwitchRow
            checked={settings.quietIncludesMedicine}
            disabled={off}
            onChange={(quietIncludesMedicine) => store({ ...settings, quietIncludesMedicine })}
            label={t('notifications.quiet.medicine')}
            description={t('notifications.quiet.medicineHelp')}
          />
        </>
      )}
      <SwitchRow
        icon="eye"
        checked={settings.showNames}
        disabled={off}
        onChange={(showNames) => store({ ...settings, showNames })}
        label={t('notifications.names.switch')}
        description={t('notifications.names.help')}
      />
      <Typography variant="body2" color="text.secondary">
        {t('notifications.timeZone', { zone })}
      </Typography>
      <ErrorNotice message={save.error} />
    </Stack>
  );
}
