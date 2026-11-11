import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, ButtonBase, IconButton, Popover, Typography } from '@mui/material';
import { AppSnackbar } from '../ui/AppSnackbar';
import { describeApiError } from '../api/errorMessages';
import { canLog } from '../baby/permissions';
import { useEventAccess } from '../baby/useEventAccess';
import { useEventTypes, useRunningEvents } from '../db/hooks';
import type { Baby, EventType } from '../db/models';
import { formatElapsed, useNow } from '../events/time';
import { formatDuration } from '../i18n/format';
import { usePresetActions } from '../presets/usePresetActions';
import { RADIUS } from '../theme/tokens';
import { useNightFeed } from '../theme/NightFeedContext';
import { palette } from '../ui/form/styles';
import { Icon } from '../ui/Icon';
import { EventIllustration } from '../ui/illustrations/EventIllustration';
import { effectiveElapsedSeconds, isPaused } from './pauseMath';
import { runningTimers, type RunningTimer } from './runningTimers';
import { PauseAnnouncer, PausedClock, PauseResumeButton } from './TimerParts';
import { useInlineTimersShown } from './inlineTimers';
import { useTimerTitle } from './useTimerTitle';
import { TimerSheetHost } from './TimerSheetHost';
import { useTimerCommands } from './useTimerCommands';

interface RowProps {
  timer: RunningTimer;
  nowMs: number;
  /** Viewers and the Doctor see the timer but no controls. */
  readOnly: boolean;
  /** A timer the user may not stop or pause (someone else's nursing): the sheet says why. */
  locked: boolean;
  onOpen: () => void;
  onTogglePause: () => void;
  onStop: () => void;
}

/** One running timer in the popover: illustration, name, live time, pause and stop. */
function ListRow({ timer, nowMs, readOnly, locked, onOpen, onTogglePause, onStop }: RowProps) {
  const { t } = useTranslation();
  const title = useTimerTitle();
  const name = title(timer);
  const paused = isPaused(timer.event);
  const effective = effectiveElapsedSeconds(timer.event, nowMs);
  return (
    <Box component="li" sx={{ display: 'flex', alignItems: 'center', gap: 0.5, listStyle: 'none' }}>
      <ButtonBase
        onClick={onOpen}
        aria-label={t('timers.mini.open', { name })}
        sx={{
          flex: '1 1 auto',
          minWidth: 0,
          minHeight: 56,
          gap: 1.25,
          justifyContent: 'flex-start',
          textAlign: 'start',
          borderRadius: `${RADIUS.input}px`,
          px: 0.5,
        }}
      >
        <EventIllustration type={timer.type} payload={timer.event.payload} size={32} />
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>
            {name}
          </Typography>
          <Typography
            aria-hidden
            data-testid="timer-row-elapsed"
            sx={(theme) => ({
              fontFamily: theme.typography.fontFamilyDisplay,
              fontVariantNumeric: 'tabular-nums',
              color: paused ? palette(theme).text.secondary : palette(theme).text.primary,
            })}
          >
            {formatElapsed(effective * 1000)}
          </Typography>
          {paused && <PausedClock event={timer.event} nowMs={nowMs} compact />}
        </Box>
      </ButtonBase>
      {!locked && !readOnly && (
        <>
          <PauseResumeButton variant="icon" paused={paused} name={name} onPress={onTogglePause} />
          <StopIconButton name={name} onPress={onStop} />
        </>
      )}
    </Box>
  );
}

function StopIconButton({ name, onPress }: { name: string; onPress: () => void }) {
  const { t } = useTranslation();
  return (
    <IconButton
      onClick={onPress}
      aria-label={t('timers.stopNamed', { name })}
      data-testid="timer-stop"
      sx={(theme) => ({
        width: 44,
        height: 44,
        backgroundColor: palette(theme).primary.main,
        color: palette(theme).primary.contrastText,
        '&:hover': { backgroundColor: palette(theme).primary.main },
      })}
    >
      <Icon name="stop" size={20} />
    </IconButton>
  );
}

interface PillProps {
  timers: RunningTimer[];
  readOnly: boolean;
  isLocked: (timer: RunningTimer) => boolean;
  onOpen: (id: string) => void;
  onToggle: (timer: RunningTimer) => void;
  onStop: (timer: RunningTimer) => void;
}

/** The pill itself and the popover it opens. The main timer shows; the rest add a count. */
function Pill({ timers, readOnly, isLocked, onOpen, onToggle, onStop }: PillProps) {
  const { t } = useTranslation();
  const title = useTimerTitle();
  const nowMs = useNow(1000);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);

  const [main] = timers;
  const name = title(main);
  const paused = isPaused(main.event);
  const effective = effectiveElapsedSeconds(main.event, nowMs);
  const extra = timers.length - 1;
  const label =
    extra > 0
      ? t('timers.pill.openMany', { name, count: timers.length })
      : t('timers.pill.open', { name });

  return (
    <>
      <PauseAnnouncer paused={paused} name={name} />
      <ButtonBase
        onClick={(e) => setAnchor(e.currentTarget)}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={anchor !== null}
        data-testid="timer-pill"
        sx={(theme) => ({
          flex: '0 0 auto',
          minHeight: 44,
          minWidth: 44,
          px: 1,
          gap: 0.5,
          borderRadius: `${RADIUS.pill}px`,
          backgroundColor: `color-mix(in srgb, ${palette(theme).primary.main} 14%, ${palette(theme).background.paper})`,
          color: palette(theme).text.primary,
          border: `1px solid color-mix(in srgb, ${palette(theme).primary.main} 30%, transparent)`,
          '&:focus-visible': {
            outline: `2px solid ${palette(theme).primary.main}`,
            outlineOffset: 2,
          },
          '@media (forced-colors: active)': { border: '1px solid ButtonText' },
        })}
      >
        <EventIllustration type={main.type} payload={main.event.payload} size={22} />
        {paused && <Icon name="pause" size={16} />}
        <Typography
          component="span"
          aria-hidden
          data-testid="timer-pill-elapsed"
          sx={(theme) => ({
            fontFamily: theme.typography.fontFamilyDisplay,
            fontSize: '0.9375rem',
            fontWeight: 600,
            lineHeight: 1,
            fontVariantNumeric: 'tabular-nums lining-nums',
            color: paused ? palette(theme).text.secondary : palette(theme).text.primary,
          })}
        >
          {formatElapsed(effective * 1000)}
        </Typography>
        {extra > 0 && (
          <Box
            component="span"
            aria-hidden
            data-testid="timer-pill-count"
            sx={(theme) => ({
              fontSize: '0.75rem',
              fontWeight: 700,
              lineHeight: 1,
              px: 0.5,
              py: 0.375,
              borderRadius: `${RADIUS.pill}px`,
              backgroundColor: palette(theme).primary.main,
              color: palette(theme).primary.contrastText,
            })}
          >
            +{extra}
          </Box>
        )}
        <Box
          component="span"
          sx={{
            position: 'absolute',
            width: '1px',
            height: '1px',
            overflow: 'hidden',
            clip: 'rect(0 0 0 0)',
          }}
        >
          {t('timers.announce.running', { name, duration: formatDuration(effective * 1000) })}
        </Box>
      </ButtonBase>
      <Popover
        open={anchor !== null}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{
          paper: {
            role: 'dialog',
            'aria-label': t('timers.region'),
            sx: (theme) => ({
              mt: 1,
              p: 1,
              width: 'min(360px, calc(100vw - 24px))',
              maxHeight: 'min(70dvh, 420px)',
              borderRadius: `${RADIUS.card}px`,
              boxShadow: palette(theme).navShadow,
              '[data-dark] &': { backgroundColor: palette(theme).surfaceRaised },
            }),
          },
        }}
      >
        <Box component="ul" aria-label={t('timers.mini.list')} sx={{ m: 0, p: 0 }}>
          {timers.map((timer) => (
            <ListRow
              key={timer.event.id}
              timer={timer}
              nowMs={nowMs}
              readOnly={readOnly}
              locked={isLocked(timer)}
              onOpen={() => {
                setAnchor(null);
                onOpen(timer.event.id);
              }}
              onTogglePause={() => onToggle(timer)}
              onStop={() => onStop(timer)}
            />
          ))}
        </Box>
      </Popover>
    </>
  );
}

const NO_TYPES: EventType[] = [];

/**
 * The running-timer pill of the top header (docs/DESIGN.md; it replaces the floating mini timer
 * bar): a compact live pill next to the sync icon with the main timer's illustration and
 * pause-aware time (a sleep first, then nursing, then the rest) and a "+N" for the others. Tapping
 * it opens a popover with each timer's Pause/Resume and Stop; a row opens the timer sheet. It takes
 * no page space, so nothing is reserved for it. Hidden in the Night view (its giant buttons do the
 * job), on the Now screen (its "Running now" cards show the same timers, `useClaimInlineTimers`)
 * and while nothing runs. Viewers and the Doctor see the time but get no controls. Mount it once in
 * the header, keyed by baby. The component also owns what outlives the pill: the timer sheet, the
 * finish sheet of a stop and the Undo snackbar.
 */
export function RunningTimerPill({ baby }: { baby: Baby }) {
  const night = useNightFeed().active;
  // The Now screen shows the same timers as cards at the top of its page.
  const inline = useInlineTimersShown();
  const types = useEventTypes(baby.id);
  const running = useRunningEvents(baby.id);
  const commands = useTimerCommands();
  const actions = usePresetActions(baby.id, types ?? NO_TYPES);
  const [sheetId, setSheetId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const readOnly = !canLog(baby);
  const access = useEventAccess(baby);
  const title = useTimerTitle();

  const timers = types && running && !night && !inline ? runningTimers(running, types) : [];
  const sheetTimer = timers.find((timer) => timer.event.id === sheetId);

  const run = (action: () => Promise<unknown>) => {
    setError(null);
    void action().catch((e: unknown) => setError(describeApiError(e)));
  };
  const toggle = (timer: RunningTimer) =>
    run(() =>
      isPaused(timer.event) ? commands.resume(timer.event.id) : commands.pause(timer.event.id),
    );
  const stop = (timer: RunningTimer) =>
    run(() => actions.stop(timer.event, { name: title(timer) }));

  return (
    <>
      {timers.length > 0 && (
        <Pill
          timers={timers}
          readOnly={readOnly}
          isLocked={(timer) => access.controlLockedBy(timer.event) !== null}
          onOpen={setSheetId}
          onToggle={toggle}
          onStop={stop}
        />
      )}
      {types && (
        <TimerSheetHost
          babyId={baby.id}
          types={types}
          event={sheetTimer?.event}
          readOnly={readOnly}
          access={access}
          commands={commands}
          actions={actions}
          run={run}
          onClose={() => setSheetId(null)}
        />
      )}
      {actions.elements}
      <AppSnackbar
        open={error !== null}
        autoHideDuration={5000}
        onClose={() => setError(null)}
        message={error}
      />
    </>
  );
}
