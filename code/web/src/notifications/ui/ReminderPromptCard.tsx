import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Button, Card, Stack, Typography } from '@mui/material';
import { ApiError } from '../../api/ApiError';
import { describeApiError } from '../../api/errorMessages';
import { canWrite } from '../../baby/permissions';
import type { Baby } from '../../db/models';
import { ErrorNotice } from '../../settings/ErrorNotice';
import { useOnline } from '../../sync/useOnline';
import { Icon } from '../../ui/Icon';
import { enablePush } from '../pushActions';
import { putBabyPreferences } from '../pushApi';
import { usePushDevice } from '../PushDeviceContext';
import {
  readPromptDismissedAt,
  shouldOfferDoseReminders,
  writePromptDismissedAt,
} from '../reminderPrompt';
import {
  useBabyPreferences,
  usePushConfig,
  usePushContext,
  useRefreshPush,
  useThisDevice,
} from '../usePush';
import { PushExplainerSheet } from './PushExplainerSheet';

/** Server and device facts for the offer; `null` until they are loaded (nothing is shown). */
function useDoseReminderOffer(baby: Baby) {
  const device = usePushDevice();
  const config = usePushConfig();
  const enabled = !!config.data?.enabled && device.support() === 'supported';
  const thisDevice = useThisDevice(enabled);
  const preferences = useBabyPreferences(enabled);
  if (!config.data) return null;
  if (enabled && (!thisDevice.data || !preferences.data)) return null;
  const prefs = preferences.data?.find((p) => p.babyId === baby.id);
  const visible = shouldOfferDoseReminders({
    serverEnabled: config.data.enabled,
    support: device.support(),
    permission: thisDevice.data?.permission ?? device.permission(),
    subscribed: !!thisDevice.data?.endpoint,
    doseDueOn: !!prefs?.doseDue,
    canReceive: prefs?.canReceive ?? canWrite(baby),
    dismissedAt: readPromptDismissedAt(),
    now: new Date(),
  });
  return {
    visible,
    publicKey: config.data.publicKey ?? '',
    subscribed: !!thisDevice.data?.endpoint,
    prefs: {
      doseDue: true,
      doseLeadMinutes: prefs?.doseLeadMinutes ?? 0,
      napWindow: prefs?.napWindow ?? false,
      napLeadMinutes: prefs?.napLeadMinutes ?? 10,
    },
  } as const;
}

interface Props {
  baby: Baby;
  /** The card is done (Not now, or closed after turning reminders on). */
  onClose: () => void;
}

/**
 * "Get a reminder at the scheduled times?" after a scheduled prescription was saved
 * (docs/design/09-push-notifications.md section 11). Turn on goes through the same explainer as
 * Settings (the browser prompt only from its button), then subscribes this device and turns on
 * medicine reminders for this baby. Never shown where push cannot work or is already on.
 */
export function ReminderPromptCard({ baby, onClose }: Props) {
  const { t } = useTranslation();
  const device = usePushDevice();
  const context = usePushContext();
  const refresh = useRefreshPush();
  const online = useOnline();
  const offer = useDoseReminderOffer(baby);
  const [explainer, setExplainer] = useState(false);
  const [pending, setPending] = useState(false);
  /** How the offer ended; the card stays to say so until it is closed. */
  const [outcome, setOutcome] = useState<'on' | 'denied' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const done = outcome !== null;

  if (!offer || (!offer.visible && !done)) return null;

  const notNow = () => {
    writePromptDismissedAt(new Date());
    onClose();
  };

  // The permission request is the first thing the click does: Safari needs the user gesture.
  const turnOn = async () => {
    const permission =
      device.permission() === 'granted' ? 'granted' : await device.requestPermission();
    setExplainer(false);
    if (permission !== 'granted') {
      setOutcome('denied');
      await refresh();
      return;
    }
    setPending(true);
    setError(null);
    try {
      if (!offer.subscribed) await enablePush(context, offer.publicKey);
      await putBabyPreferences(context.api, baby.id, offer.prefs);
      setOutcome('on');
    } catch (e) {
      setError(
        e instanceof ApiError ? describeApiError(e) : t('notifications.announce.subscribeFailed'),
      );
    } finally {
      setPending(false);
      await refresh();
    }
  };

  return (
    <Card component="section" aria-label={t('notifications.prompt.title')} sx={{ p: 2.5 }}>
      <Stack spacing={1.5}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
          <Icon name="bell" size={20} sx={{ color: 'text.secondary', flex: 'none' }} />
          <Typography variant="subtitle1" component="h2">
            {t('notifications.prompt.title')}
          </Typography>
        </Box>
        <Typography role="status" color={done ? 'text.primary' : 'text.secondary'}>
          {outcome === 'on'
            ? t('notifications.prompt.done', { name: baby.name })
            : outcome === 'denied'
              ? t('notifications.announce.denied')
              : t('notifications.prompt.body')}
        </Typography>
        {!done && !online && (
          <Typography variant="body2" color="text.secondary">
            {t('notifications.offline')}
          </Typography>
        )}
        <ErrorNotice message={error} />
        <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
          {done ? (
            <Button onClick={onClose} sx={{ minHeight: 48 }}>
              {t('common.done')}
            </Button>
          ) : (
            <>
              <Button onClick={notNow} sx={{ minHeight: 48 }}>
                {t('notifications.prompt.notNow')}
              </Button>
              <Button
                variant="contained"
                onClick={() => setExplainer(true)}
                disabled={!online || pending}
                sx={{ minHeight: 48 }}
              >
                {t('notifications.prompt.turnOn')}
              </Button>
            </>
          )}
        </Stack>
      </Stack>
      <PushExplainerSheet
        open={explainer}
        pending={pending}
        onClose={() => setExplainer(false)}
        onTurnOn={() => void turnOn()}
      />
    </Card>
  );
}
