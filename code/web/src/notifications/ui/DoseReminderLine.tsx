import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Button, Typography } from '@mui/material';
import { useApiClient } from '../../api/ApiClientContext';
import { describeApiError } from '../../api/errorMessages';
import { formatTime } from '../../i18n/format';
import { ErrorNotice } from '../../settings/ErrorNotice';
import { useOnline } from '../../sync/useOnline';
import { Icon } from '../../ui/Icon';
import { postDeliveryAction, type DeliveryAction } from '../pushApi';

interface Props {
  /** The slot from local data (never from the notification). */
  slotAt: Date;
  deliveryId: string;
  /** The per-delivery action token; without it no snooze is offered. */
  token?: string;
}

type Phase = 'due' | 'snoozed' | 'stopped';

/**
 * "Reminder for 18:00" inside the Meds tray card the notification opened, with Snooze 30 min and,
 * after a snooze, Stop reminders for this dose (docs/design/09-push-notifications.md sections 3
 * and 11). The server enforces the rules (30 minutes, at most 3 snoozes, per user). Logging stays
 * the card's own flow: nothing here logs or confirms a dose.
 */
export function DoseReminderLine({ slotAt, deliveryId, token }: Props) {
  const { t } = useTranslation();
  const api = useApiClient();
  const online = useOnline();
  const ref = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<Phase>('due');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    ref.current?.scrollIntoView?.({ block: 'nearest' });
  }, []);

  const act = async (action: DeliveryAction, next: Phase) => {
    if (!token) return;
    setPending(true);
    setError(null);
    try {
      await postDeliveryAction(api, deliveryId, action, token);
      setPhase(next);
    } catch (e) {
      setError(describeApiError(e));
    } finally {
      setPending(false);
    }
  };

  const status =
    phase === 'snoozed'
      ? t('notifications.reminderLine.snoozed')
      : phase === 'stopped'
        ? t('notifications.reminderLine.stopped')
        : '';

  return (
    <Box ref={ref} sx={{ display: 'grid', gap: 0.75, pt: 0.5 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
        <Icon name="bell" size={16} sx={{ color: 'text.secondary' }} />
        <Typography variant="body2" sx={{ flex: '1 1 auto' }}>
          {t('notifications.reminderLine.at', { time: formatTime(slotAt) })}
        </Typography>
        {token && phase === 'due' && (
          <Button
            onClick={() => void act('snooze', 'snoozed')}
            disabled={!online || pending}
            sx={{ minHeight: 48 }}
          >
            {t('notifications.reminderLine.snooze')}
          </Button>
        )}
        {token && phase === 'snoozed' && (
          <Button
            onClick={() => void act('dismiss', 'stopped')}
            disabled={!online || pending}
            sx={{ minHeight: 48 }}
          >
            {t('notifications.reminderLine.stop')}
          </Button>
        )}
      </Box>
      <Typography role="status" variant="body2" color="text.secondary">
        {status}
      </Typography>
      {token && phase !== 'stopped' && !online && (
        <Typography variant="body2" color="text.secondary">
          {t('notifications.reminderLine.offline')}
        </Typography>
      )}
      <ErrorNotice message={error} />
    </Box>
  );
}
