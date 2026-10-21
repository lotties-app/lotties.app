import { useTranslation } from 'react-i18next';
import { Box, Button, Card, Stack, Typography } from '@mui/material';
import type { BabyEvent, EventType } from '../../db/models';
import { formatElapsed, useNow } from '../../events/time';
import { effectiveElapsedSeconds, isPaused } from '../../timers/pauseMath';
import { PausedClock, PauseResumeButton } from '../../timers/TimerParts';
import { useTimerCommands } from '../../timers/useTimerCommands';
import { useEventTypeText } from '../../i18n/eventTypeText';
import { formatDuration, formatTime } from '../../i18n/format';
import type { PresetActions } from '../../presets/usePresetActions';
import { Icon } from '../../ui/Icon';
import { illustrationKeyFor } from '../../ui/illustrations/eventKey';
import { EventIllustration } from '../../ui/illustrations/EventIllustration';
import { otherTimers, type ForgottenTimer } from '../timers';
import { ForgottenNotice } from './ForgottenNotice';
import type { NowAction } from './useNowAction';

interface Props {
  /** Every running timer of the baby. */
  running: readonly BabyEvent[];
  types: readonly EventType[];
  forgotten: ReadonlyMap<string, ForgottenTimer>;
  /** The nursing session id, shown by its own card. */
  nursingId: string | null;
  actions: PresetActions;
  readOnly: boolean;
  isSnoozed: (eventId: string) => boolean;
  onKeepRunning: (eventId: string) => void;
  action: NowAction;
}

interface RowProps {
  event: BabyEvent;
  type: EventType | undefined;
  nowMs: number;
  forgotten: ForgottenTimer | undefined;
  actions: PresetActions;
  readOnly: boolean;
  snoozed: boolean;
  onKeepRunning: (eventId: string) => void;
  action: NowAction;
}

function TimerRow({
  event,
  type,
  nowMs,
  forgotten,
  actions,
  readOnly,
  snoozed,
  onKeepRunning,
  action,
}: RowProps) {
  const { t } = useTranslation();
  const names = useEventTypeText();
  const name = type ? names.typeName(type) : t('common.event');
  const commands = useTimerCommands();
  const paused = isPaused(event);
  const elapsed = effectiveElapsedSeconds(event, nowMs) * 1000;
  return (
    <Card component="article" aria-label={name} sx={{ p: 1.5 }}>
      <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
        <EventIllustration type={type} payload={event.payload} size={48} />
        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
          <Typography variant="subtitle1" noWrap>
            {name}
          </Typography>
          <Typography
            variant="h5"
            component="time"
            dateTime={event.startedAt}
            sx={(theme) => ({
              fontVariantNumeric: 'tabular-nums',
              display: 'block',
              color: paused ? theme.palette.text.secondary : undefined,
            })}
          >
            {formatElapsed(elapsed)}
          </Typography>
          {paused && <PausedClock event={event} nowMs={nowMs} compact />}
        </Box>
        <PauseResumeButton
          variant="icon"
          paused={paused}
          name={name}
          disabled={readOnly}
          onPress={() =>
            void action.run(() => (paused ? commands.resume(event.id) : commands.pause(event.id)))
          }
        />
        <Button
          variant="outlined"
          color="inherit"
          disabled={readOnly}
          startIcon={<Icon name="stop" size={20} />}
          aria-label={t('home.stopNamed', { name })}
          onClick={() => void actions.stop(event, { name })}
          sx={{ minHeight: 48, minWidth: 96 }}
        >
          {t('home.stop')}
        </Button>
      </Stack>
      {forgotten && !snoozed && (
        <Box sx={{ mt: 1.5 }}>
          <ForgottenNotice
            art={illustrationKeyFor(type, event.payload)}
            title={t('now.forgotten.running', {
              name,
              duration: formatDuration(elapsed),
            })}
            endLabel={t('now.forgotten.stopAt', { time: formatTime(forgotten.suggestedEnd) })}
            onEnd={() => void actions.stop(event, { name, endedAt: forgotten.suggestedEnd })}
            onKeep={() => onKeepRunning(event.id)}
            disabled={readOnly}
          />
        </Box>
      )}
    </Card>
  );
}

/**
 * The other running timers (tummy time, bath, pumping, custom types, an old feeding timer): a
 * calm card each with a live clock and a neutral Stop. A timer past its threshold gets the
 * "Still running? Stop at 14:20" note. Stopping a timer that lacks required fields opens the
 * short finish sheet (never a stop the server would reject).
 */
export function TimersBar({
  running,
  types,
  forgotten,
  nursingId,
  actions,
  readOnly,
  isSnoozed,
  onKeepRunning,
  action,
}: Props) {
  const { t } = useTranslation();
  const nowMs = useNow(1000);
  const timers = otherTimers(running, types, nursingId);
  if (timers.length === 0) return null;
  return (
    <Stack spacing={1.5} component="section" aria-label={t('home.runningTimers')}>
      {timers.map((event) => (
        <TimerRow
          key={event.id}
          event={event}
          type={types.find((candidate) => candidate.id === event.typeId)}
          nowMs={nowMs}
          forgotten={forgotten.get(event.id)}
          actions={actions}
          readOnly={readOnly}
          snoozed={isSnoozed(event.id)}
          onKeepRunning={onKeepRunning}
          action={action}
        />
      ))}
    </Stack>
  );
}
