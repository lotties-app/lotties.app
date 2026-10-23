import { useTranslation } from 'react-i18next';
import { Box, Button, Card, Stack, Typography } from '@mui/material';
import type { BabyEvent } from '../../db/models';
import { formatElapsed, useNow } from '../../events/time';
import { formatTime } from '../../i18n/format';
import { RADIUS } from '../../theme/tokens';
import { Illustration } from '../../ui/illustrations';
import { palette } from '../../ui/form/styles';
import { Icon } from '../../ui/Icon';
import { PausedClock, PauseResumeButton } from '../../timers/TimerParts';
import { useTimerCommands } from '../../timers/useTimerCommands';
import { nursingElapsed, type BreastSide } from '../nursing';
import type { NowCommands } from '../useNowCommands';
import { LockedNote } from '../../baby/LockedNote';
import type { NowAction } from './useNowAction';

interface Props {
  /** The running nursing session. */
  event: BabyEvent;
  commands: Pick<NowCommands, 'switchSide' | 'stopNursing'>;
  action: NowAction;
  readOnly: boolean;
  /**
   * Who started the session when the user may not use its controls (`EventAccess.controlLockedBy`:
   * someone else's nursing session moves its side clock, which a Caregiver may not change).
   */
  lockedBy?: string | null;
  /** Bigger targets for the night view. */
  large?: boolean;
}

const SIDES: readonly BreastSide[] = ['left', 'right'];

function SideButton({
  side,
  seconds,
  active,
  paused,
  disabled,
  large,
  onPress,
}: {
  paused: boolean;
  side: BreastSide;
  seconds: number;
  active: boolean;
  disabled: boolean;
  large: boolean;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  const label = side === 'left' ? t('now.nursing.left') : t('now.nursing.right');
  return (
    <Box
      component="button"
      type="button"
      aria-pressed={active}
      disabled={disabled}
      onClick={onPress}
      sx={(theme) => ({
        appearance: 'none',
        border: 0,
        font: 'inherit',
        cursor: 'pointer',
        minHeight: large ? 144 : 112,
        borderRadius: `${RADIUS.card}px`,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 0.25,
        color: palette(theme).text.primary,
        backgroundColor: active ? palette(theme).category.feeding.bg : palette(theme).surfaceRaised,
        boxShadow: active ? `inset 0 0 0 2.5px ${palette(theme).primary.main}` : 'none',
        '&:focus-visible': {
          outline: `2px solid ${palette(theme).primary.main}`,
          outlineOffset: 2,
        },
        '&:disabled': { opacity: 0.55, cursor: 'not-allowed' },
        '@media (forced-colors: active)': { border: active ? '3px solid Highlight' : '1px solid' },
      })}
    >
      <Typography variant="subtitle1" component="span">
        {label}
      </Typography>
      <Typography
        variant="h4"
        component="span"
        sx={{ fontVariantNumeric: 'tabular-nums' }}
        data-testid={`nursing-${side}`}
      >
        {formatElapsed(seconds * 1000)}
      </Typography>
      <Typography variant="caption" component="span" color="text.secondary">
        {active
          ? paused
            ? t('timers.paused')
            : t('now.nursing.running')
          : seconds > 0
            ? t('now.nursing.done')
            : ''}
        {' '}
      </Typography>
    </Box>
  );
}

/**
 * The running nursing session: one large timer per side (the running side highlighted), "Switch
 * side" and "Finish". The seconds live in the event, so they survive a reload and sync to the
 * other caregiver.
 */
export function NursingCard({
  event,
  commands,
  action,
  readOnly,
  lockedBy = null,
  large = false,
}: Props) {
  const { t } = useTranslation();
  const now = new Date(useNow(1000));
  const elapsed = nursingElapsed(event, now);
  const running = elapsed.side ?? 'left';
  const disabled = readOnly || lockedBy !== null;
  const timers = useTimerCommands();
  const paused = elapsed.paused;

  return (
    <Card component="section" aria-label={t('now.nursing.region')} sx={{ p: 2.5 }}>
      <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', mb: 2 }}>
        <Illustration name="nursing" size={48} glow />
        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
          <Typography variant="h5" component="h2">
            {t('now.nursing.title')}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {t('now.nursing.started', { time: formatTime(event.startedAt) })}
          </Typography>
          {paused && (
            <Box sx={{ mt: 0.5 }}>
              <PausedClock event={event} nowMs={now.getTime()} compact />
            </Box>
          )}
        </Box>
        <Typography
          variant="h4"
          component="time"
          data-testid="nursing-total"
          sx={{ fontVariantNumeric: 'tabular-nums' }}
        >
          {formatElapsed(elapsed.total * 1000)}
        </Typography>
      </Stack>
      <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5 }}>
        {SIDES.map((side) => (
          <SideButton
            key={side}
            side={side}
            seconds={elapsed[side]}
            active={running === side}
            paused={paused}
            disabled={disabled}
            large={large}
            onPress={() => {
              if (running !== side) void action.run(() => commands.switchSide(event.id, side));
            }}
          />
        ))}
      </Box>
      {/* Readers (Viewer, Doctor) follow the session without its controls. */}
      {!readOnly && (
        <>
          <Box sx={{ display: 'flex', gap: 1.5, mt: 2 }}>
            <Button
              variant="outlined"
              color="inherit"
              disabled={disabled}
              startIcon={<Icon name="arrow-right" size={20} />}
              onClick={() => void action.run(() => commands.switchSide(event.id))}
              sx={{ flex: 1, minHeight: 56 }}
            >
              {t('now.nursing.switch')}
            </Button>
            <PauseResumeButton
              paused={paused}
              name={t('now.nursing.title')}
              large
              disabled={disabled}
              onPress={() =>
                void action.run(() => (paused ? timers.resume(event.id) : timers.pause(event.id)))
              }
            />
          </Box>
          <Button
            variant="contained"
            fullWidth
            disabled={disabled}
            startIcon={<Icon name="check" size={20} />}
            onClick={() => void action.run(() => commands.stopNursing(event.id))}
            sx={{ mt: 1.5, minHeight: 56 }}
          >
            {t('now.nursing.finish')}
          </Button>
        </>
      )}
      {lockedBy !== null && (
        <Box sx={{ mt: 1 }}>
          <LockedNote name={lockedBy} />
        </Box>
      )}
    </Card>
  );
}
