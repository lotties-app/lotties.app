import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Button, Card, Stack, Typography } from '@mui/material';
import { useServerAction } from '../settings/useServerAction';
import { NativeTimeInput } from '../ui/form/NativeTimeInput';
import { upAtFromTime } from './restModel';
import { useRestActions } from './useRest';

/**
 * "Are you up for the day?" (R5): up now, up since a time, or not yet. "Not yet" calls nothing;
 * the question comes back the next time the tab is opened. No push, no reminder.
 */
export function MorningQuestion({ night, onNotYet }: { night: string; onNotYet: () => void }) {
  const { t } = useTranslation();
  const { answerMorning } = useRestActions();
  const action = useServerAction();
  const [picking, setPicking] = useState(false);
  const [time, setTime] = useState('');
  const upAt = upAtFromTime(time, new Date());
  const send = (at: string) => void action.run(() => answerMorning(night, at));
  return (
    <Card component="section" aria-labelledby="rest-morning-title" sx={{ p: 2.5 }}>
      <Typography id="rest-morning-title" variant="h6" component="h2">
        {t('rest.morning.title')}
      </Typography>
      <Stack spacing={1} sx={{ mt: 1.5 }}>
        <Button
          variant="contained"
          disabled={action.pending}
          onClick={() => send(new Date().toISOString())}
          sx={{ minHeight: 44 }}
        >
          {t('rest.morning.now')}
        </Button>
        {picking ? (
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <NativeTimeInput
              size="field"
              value={time}
              onChange={setTime}
              invalid={false}
              aria-label={t('rest.morning.timeLabel')}
            />
            <Button
              variant="contained"
              disabled={action.pending || !upAt}
              onClick={() => upAt && send(upAt)}
              sx={{ minHeight: 44 }}
            >
              {t('rest.morning.confirm')}
            </Button>
          </Stack>
        ) : (
          <Button variant="outlined" onClick={() => setPicking(true)} sx={{ minHeight: 44 }}>
            {t('rest.morning.since')}
          </Button>
        )}
        <Button onClick={onNotYet} disabled={action.pending} sx={{ minHeight: 44 }}>
          {t('rest.morning.notYet')}
        </Button>
      </Stack>
      {action.error && (
        <Alert severity="error" sx={{ mt: 1.5 }}>
          {action.error}
        </Alert>
      )}
    </Card>
  );
}
