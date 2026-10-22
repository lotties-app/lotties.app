import { Box } from '@mui/material';
import type { BabyEvent, EventType } from '../../db/models';
import { useNow } from '../../events/time';
import { PausedClock, PauseResumeButton } from '../../timers/TimerParts';
import { TimerTarget } from '../../timers/TimerTarget';
import { useTimerCommands } from '../../timers/useTimerCommands';
import { useTimerTitle } from '../../timers/useTimerTitle';
import type { AsleepState } from '../nowState';
import type { NowAction } from './useNowAction';

interface Props {
  state: AsleepState;
  babyId: string;
  /** The running timer's event (the sleep, or the night waking while one runs). */
  event: BabyEvent | undefined;
  type: EventType | undefined;
  readOnly: boolean;
  /**
   * Who started the timer when the user may not pause it (`EventAccess.controlLockedBy`); the state
   * card's sleep buttons explain it.
   */
  lockedBy?: string | null;
  action: NowAction;
}

/**
 * Under the asleep hero: the quiet target with its progress (a nap or a night, not a night
 * waking), "Paused 02:10" live while paused, and Pause/Resume. Pausing means the baby stirred or
 * was briefly awake: it is not "woke up", the sleep toggle below is unchanged.
 */
export function SleepTimerRow({
  state,
  babyId,
  event,
  type,
  readOnly,
  lockedBy = null,
  action,
}: Props) {
  const title = useTimerTitle();
  const nowMs = useNow(1000);
  const commands = useTimerCommands();
  if (state.fromMarker || !event) return null;
  const waking = state.nightWaking;
  const paused = (waking ?? state).paused !== undefined;
  const name = title({ event, type, kind: waking ? 'waking' : 'sleep' });
  return (
    <Box sx={{ mt: 2, display: 'grid', gap: 1.25 }}>
      {!waking && <TimerTarget babyId={babyId} event={event} nowMs={nowMs} />}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
        <Box sx={{ minWidth: 0 }}>{paused && <PausedClock event={event} nowMs={nowMs} />}</Box>
        <PauseResumeButton
          variant="inline"
          paused={paused}
          name={name}
          disabled={readOnly || lockedBy !== null}
          onPress={() =>
            void action.run(() => (paused ? commands.resume(event.id) : commands.pause(event.id)))
          }
        />
      </Box>
    </Box>
  );
}
