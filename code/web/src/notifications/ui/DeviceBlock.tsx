import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Button, Stack, Typography } from '@mui/material';
import { ApiError } from '../../api/ApiError';
import { useConsent } from '../../consent/ConsentContext';
import { describeApiError } from '../../api/errorMessages';
import { ErrorNotice } from '../../settings/ErrorNotice';
import { SwitchRow } from '../../ui/form';
import { devicePushState, type DevicePushState } from '../permissionState';
import { disablePush, enablePush } from '../pushActions';
import { sendTestPush } from '../pushApi';
import { usePushDevice } from '../PushDeviceContext';
import { usePushContext, useRefreshPush, type ThisDeviceState } from '../usePush';
import { PushExplainerSheet } from './PushExplainerSheet';

const STATE_MESSAGE = {
  unsupported: 'notifications.states.unsupported',
  'ios-needs-install': 'notifications.states.iosNeedsInstall',
  'ios-too-old': 'notifications.states.iosTooOld',
} as const;

const messageFor = (state: DevicePushState) =>
  state === 'unsupported' || state === 'ios-needs-install' || state === 'ios-too-old'
    ? STATE_MESSAGE[state]
    : null;

interface Props {
  publicKey: string;
  thisDevice: ThisDeviceState | undefined;
  online: boolean;
  /** Polite live-region message ("Notifications are on for this device"). */
  announce: (message: string) => void;
}

/** "Notifications on this device": platform guidance, the switch, and the test send. */
export function DeviceBlock({ publicKey, thisDevice, online, announce }: Props) {
  const { t } = useTranslation();
  const device = usePushDevice();
  const context = usePushContext();
  const refresh = useRefreshPush();
  const consent = useConsent();
  const [explainer, setExplainer] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const state = devicePushState({
    serverEnabled: true,
    support: device.support(),
    permission: thisDevice?.permission ?? device.permission(),
    subscribed: !!thisDevice?.endpoint,
  });

  const guarded = async (work: () => Promise<void>, failure: string) => {
    setPending(true);
    setError(null);
    try {
      await work();
    } catch (e) {
      setError(e instanceof ApiError ? describeApiError(e) : failure);
    } finally {
      setPending(false);
      await refresh();
    }
  };

  const subscribe = () =>
    guarded(async () => {
      await enablePush(context, publicKey);
      consent.recordOptional('push', true);
      announce(t('notifications.announce.on'));
    }, t('notifications.announce.subscribeFailed'));

  const turnOff = () =>
    guarded(async () => {
      await disablePush(context);
      consent.recordOptional('push', false);
      announce(t('notifications.announce.off'));
    }, t('errors.generic'));

  // The permission request is the first thing the click does: Safari needs the user gesture.
  const turnOnFromExplainer = async () => {
    const permission = await device.requestPermission();
    setExplainer(false);
    if (permission === 'granted') {
      await subscribe();
      return;
    }
    announce(t('notifications.announce.denied'));
    await refresh();
  };

  const onSwitch = (next: boolean) => {
    if (!next) void turnOff();
    else if (state === 'default') setExplainer(true);
    else void subscribe();
  };

  const test = () =>
    guarded(async () => {
      const { results } = await sendTestPush(context.api, thisDevice?.endpoint ?? undefined);
      const sent = results.length > 0 && results.every((r) => r.status === 'sent');
      announce(t(sent ? 'notifications.announce.testSent' : 'notifications.announce.testFailed'));
    }, t('errors.generic'));

  const message = messageFor(state);
  const on = state === 'on';
  const label = context.deviceLabel;

  return (
    <Stack spacing={1.5}>
      <Typography variant="subtitle1" component="h3">
        {t('notifications.device.heading')}
      </Typography>
      {message ? (
        <Alert severity="info">{t(message)}</Alert>
      ) : (
        <>
          <SwitchRow
            icon="bell"
            checked={on}
            onChange={onSwitch}
            disabled={!online || pending || state === 'denied'}
            label={t('notifications.device.switch')}
            description={
              on
                ? label
                  ? t('notifications.device.onNamed', { label })
                  : t('notifications.device.on')
                : t('notifications.device.off')
            }
          />
          <Typography variant="body2" color="text.secondary">
            {t('consent.optional.push')}
          </Typography>
          {state === 'denied' && <Alert severity="info">{t('notifications.states.denied')}</Alert>}
          {on && (
            <Button
              variant="outlined"
              onClick={() => void test()}
              disabled={!online || pending}
              sx={{ minHeight: 48, alignSelf: 'flex-start' }}
            >
              {t('notifications.device.test')}
            </Button>
          )}
        </>
      )}
      <ErrorNotice message={error} />
      <PushExplainerSheet
        open={explainer}
        pending={pending}
        onClose={() => setExplainer(false)}
        onTurnOn={() => void turnOnFromExplainer()}
      />
    </Stack>
  );
}
