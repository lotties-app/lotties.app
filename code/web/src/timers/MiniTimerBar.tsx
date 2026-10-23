import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, ButtonBase, IconButton, Snackbar, Typography } from '@mui/material';
import { describeApiError } from '../api/errorMessages';
import { canLog } from '../baby/permissions';
import { useEventAccess } from '../baby/useEventAccess';
import { useEventTypes, useRunningEvents } from '../db/hooks';
import type { Baby, EventType } from '../db/models';
import { formatElapsed, useNow } from '../events/time';
import { formatDuration } from '../i18n/format';
import { NAV_HEIGHT, NAV_INSET, TIMER_BAR_OFFSET_VAR } from '../layout/navMetrics';
import { usePresetActions } from '../presets/usePresetActions';
import { CONTENT_MAX_WIDTH, RADIUS } from '../theme/tokens';
import { useNightFeed } from '../theme/NightFeedContext';
import { palette } from '../ui/form/styles';
import { Icon } from '../ui/Icon';
import { EventIllustration } from '../ui/illustrations/EventIllustration';
import { effectiveElapsedSeconds, isPaused } from './pauseMath';
import { runningTimers, type RunningTimer } from './runningTimers';
import { PauseAnnouncer, PauseResumeButton, PausedClock } from './TimerParts';
import { useInlineTimersShown } from './inlineTimers';
import { useTimerTitle } from './useTimerTitle';
import { TimerSheetHost } from './TimerSheetHost';
import { TimerTarget } from './TimerTarget';
import { useTimerCommands } from './useTimerCommands';

/** Gap between the bar and the pill below it. */
const BAR_GAP = 8;
/** Height assumed before the bar is measured (and where nothing can measure it). */
const FALLBACK_HEIGHT = 72;
const MAX_LIST_HEIGHT = 'min(40dvh, 280px)';

/** Keeps the page padding and the toasts clear of the bar: the bar's height as a root variable. */
function useBarOffset(visible: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = document.documentElement;
    if (!visible) return;
    const apply = () =>
      root.style.setProperty(
        TIMER_BAR_OFFSET_VAR,
        `${(ref.current?.offsetHeight || FALLBACK_HEIGHT) + BAR_GAP}px`,
      );
    apply();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(apply);
    if (ref.current) observer?.observe(ref.current);
    return () => {
      observer?.disconnect();
      root.style.removeProperty(TIMER_BAR_OFFSET_VAR);
    };
  }, [visible]);
  return ref;
}

/**
 * An elevated surface that reads apart from the page under it: the paper (raised in the dark
 * schemes), a visible edge mixed from the text colour, and the lift of the navigation pill.
 */
const cardSx = (theme: Parameters<typeof palette>[0]) => ({
  pointerEvents: 'auto' as const,
  overflow: 'hidden',
  borderRadius: `${RADIUS.card}px`,
  backgroundColor: palette(theme).background.paper,
  border: `1px solid color-mix(in srgb, ${palette(theme).text.primary} 16%, ${palette(theme).hairline})`,
  boxShadow: palette(theme).navShadow,
  '[data-dark] &': { backgroundColor: palette(theme).surfaceRaised },
});

interface RowProps {
  timer: RunningTimer;
  nowMs: number;
  readOnly: boolean;
  /** A timer the user may not stop or pause (someone else's nursing): none here (the sheet says why). */
  locked: boolean;
  onOpen: () => void;
  onTogglePause: () => void;
  onStop: () => void;
}

/** One timer of the expanded list: illustration, name, live time, pause and stop. */
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
            sx={(theme) => ({
              fontFamily: theme.typography.fontFamilyDisplay,
              fontVariantNumeric: 'tabular-nums',
              color: paused ? palette(theme).text.secondary : palette(theme).text.primary,
            })}
          >
            {formatElapsed(effective * 1000)}
          </Typography>
        </Box>
      </ButtonBase>
      {!locked && (
        <>
          <PauseResumeButton
            variant="icon"
            paused={paused}
            name={name}
            disabled={readOnly}
            onPress={onTogglePause}
          />
          <StopIconButton name={name} disabled={readOnly} onPress={onStop} />
        </>
      )}
    </Box>
  );
}

function StopIconButton({
  name,
  disabled,
  onPress,
}: {
  name: string;
  disabled: boolean;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  return (
    <IconButton
      onClick={onPress}
      disabled={disabled}
      aria-label={t('timers.stopNamed', { name })}
      data-testid="timer-stop"
      sx={(theme) => ({
        width: 44,
        height: 44,
        backgroundColor: palette(theme).primary.main,
        color: palette(theme).primary.contrastText,
        '&:hover': { backgroundColor: palette(theme).primary.main },
        '&.Mui-disabled': { opacity: 0.5, color: palette(theme).primary.contrastText },
      })}
    >
      <Icon name="stop" size={20} />
    </IconButton>
  );
}

interface BarProps {
  baby: Baby;
  timers: RunningTimer[];
  readOnly: boolean;
  isLocked: (timer: RunningTimer) => boolean;
  onOpen: (id: string) => void;
  onToggle: (timer: RunningTimer) => void;
  onStop: (timer: RunningTimer) => void;
}

function Bar({ baby, timers, readOnly, isLocked, onOpen, onToggle, onStop }: BarProps) {
  const { t } = useTranslation();
  const title = useTimerTitle();
  const nowMs = useNow(1000);
  const listId = useId();
  const barRef = useBarOffset(true);
  const [expanded, setExpanded] = useState(false);

  const [main, ...others] = timers;
  const name = title(main);
  const paused = isPaused(main.event);
  const effective = effectiveElapsedSeconds(main.event, nowMs);
  // A single timer left: the list has nothing more to show.
  const listOpen = expanded && others.length > 0;

  return (
    <Box
      sx={{
        position: 'fixed',
        left: 0,
        right: 0,
        bottom: `calc(${NAV_HEIGHT + NAV_INSET + BAR_GAP}px + env(safe-area-inset-bottom))`,
        zIndex: (theme) => theme.zIndex.appBar,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 1,
        px: 2,
        pointerEvents: 'none',
      }}
    >
      {listOpen && (
        <Box
          id={listId}
          component="ul"
          aria-label={t('timers.mini.list')}
          sx={(theme) => ({
            ...cardSx(theme),
            width: '100%',
            maxWidth: CONTENT_MAX_WIDTH - 32,
            m: 0,
            p: 1,
            maxHeight: MAX_LIST_HEIGHT,
            overflowY: 'auto',
          })}
        >
          {timers.map((timer) => (
            <ListRow
              key={timer.event.id}
              timer={timer}
              nowMs={nowMs}
              readOnly={readOnly}
              locked={isLocked(timer)}
              onOpen={() => {
                setExpanded(false);
                onOpen(timer.event.id);
              }}
              onTogglePause={() => onToggle(timer)}
              onStop={() => onStop(timer)}
            />
          ))}
        </Box>
      )}
      <Box
        ref={barRef}
        component="section"
        aria-label={t('timers.region')}
        data-testid="mini-timer-bar"
        sx={(theme) => ({
          ...cardSx(theme),
          width: '100%',
          maxWidth: CONTENT_MAX_WIDTH - 32,
          '@media (prefers-reduced-motion: no-preference)': {
            animation: 'mini-timer-in 160ms ease-out',
          },
          '@keyframes mini-timer-in': {
            from: { opacity: 0, transform: 'translateY(6px)' },
            to: { opacity: 1, transform: 'none' },
          },
        })}
      >
        <PauseAnnouncer paused={paused} name={name} />
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, py: 0.5, px: 1 }}>
          <ButtonBase
            onClick={() => onOpen(main.event.id)}
            aria-label={t('timers.mini.open', { name })}
            aria-haspopup="dialog"
            data-testid="mini-timer-open"
            sx={{
              flex: '1 1 auto',
              minWidth: 0,
              minHeight: 48,
              gap: 1,
              justifyContent: 'flex-start',
              textAlign: 'start',
              borderRadius: `${RADIUS.input}px`,
              pr: 0.5,
            }}
          >
            <EventIllustration type={main.type} payload={main.event.payload} size={28} />
            {/* One line: name, then the time; it wraps under the name only when text is large. */}
            <Box
              sx={{
                minWidth: 0,
                flex: '1 1 auto',
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'baseline',
                columnGap: 1,
              }}
            >
              <Typography
                variant="body2"
                component="span"
                noWrap
                sx={(theme) => ({
                  minWidth: 0,
                  maxWidth: '100%',
                  fontWeight: 600,
                  lineHeight: 1.3,
                  color: palette(theme).text.primary,
                })}
              >
                {name}
              </Typography>
              <Typography
                component="span"
                aria-hidden
                data-testid="mini-timer-elapsed"
                sx={(theme) => ({
                  fontFamily: theme.typography.fontFamilyDisplay,
                  fontSize: '1.25rem',
                  fontWeight: 600,
                  lineHeight: 1.2,
                  fontVariantNumeric: 'tabular-nums lining-nums',
                  color: paused ? palette(theme).text.secondary : palette(theme).text.primary,
                })}
              >
                {formatElapsed(effective * 1000)}
              </Typography>
              {paused && <PausedClock event={main.event} nowMs={nowMs} compact />}
              <Box
                component="span"
                sx={{
                  position: 'absolute',
                  width: 1,
                  height: 1,
                  overflow: 'hidden',
                  clip: 'rect(0 0 0 0)',
                }}
              >
                {t('timers.announce.running', {
                  name,
                  duration: formatDuration(effective * 1000),
                })}
              </Box>
            </Box>
          </ButtonBase>
          {others.length > 0 && (
            <ButtonBase
              onClick={() => setExpanded((e) => !e)}
              aria-expanded={expanded}
              aria-controls={listOpen ? listId : undefined}
              aria-label={t('timers.mini.expand')}
              data-testid="mini-timer-count"
              sx={(theme) => ({
                minWidth: 44,
                minHeight: 36,
                px: 1,
                gap: 0.25,
                borderRadius: `${RADIUS.pill}px`,
                fontSize: '0.8125rem',
                fontWeight: 600,
                backgroundColor: palette(theme).surfaceRaised,
                color: palette(theme).text.primary,
                '&:focus-visible': { outline: `2px solid ${palette(theme).primary.main}` },
              })}
            >
              <span aria-hidden>{timers.length}</span>
              <Icon name={expanded ? 'expand' : 'collapse'} size={16} />
            </ButtonBase>
          )}
          {!isLocked(main) && (
            <>
              <PauseResumeButton
                variant="icon"
                paused={paused}
                name={name}
                disabled={readOnly}
                onPress={() => onToggle(main)}
              />
              <StopIconButton name={name} disabled={readOnly} onPress={() => onStop(main)} />
            </>
          )}
        </Box>
        {main.kind === 'sleep' && (
          <Box sx={{ px: 1.5, pb: 1.25, mt: -0.25 }}>
            <TimerTarget babyId={baby.id} event={main.event} nowMs={nowMs} compact />
          </Box>
        )}
      </Box>
    </Box>
  );
}

const NO_TYPES: EventType[] = [];

/**
 * The global mini timer bar (docs/design/SYNTHESIS.md section 6): one floating card above the
 * bottom navigation on every tab while any timer runs. It shows the main timer (a sleep first,
 * then nursing, then the rest): illustration, live pause-aware time, the quiet target with its
 * progress for a sleep, Pause/Resume and Stop. Several timers add a count chip that opens the
 * list. Tapping the card opens the timer sheet. Hidden in the Night view (its giant buttons do the
 * job), on the Now screen (its "Running now" cards show the same timers, `useClaimInlineTimers`)
 * and while nothing runs. One compact line on an elevated surface; the page reserves its height
 * through `--timer-bar-offset`, so it never covers content or the pill. Mount it once in the app shell, keyed by baby. The component also
 * owns what outlives the card: the timer sheet, the finish sheet of a stop, and the Undo snackbar.
 */
export function MiniTimerBar({ baby }: { baby: Baby }) {
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
        <Bar
          baby={baby}
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
      <Snackbar
        open={error !== null}
        autoHideDuration={5000}
        onClose={() => setError(null)}
        message={error}
      />
    </>
  );
}
