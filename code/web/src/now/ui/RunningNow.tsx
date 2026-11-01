import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Button, ButtonBase, Card, Stack, Typography } from '@mui/material';
import { LockedNote } from '../../baby/LockedNote';
import type { BabyEvent } from '../../db/models';
import { formatElapsed, useNow } from '../../events/time';
import { formatDuration, formatTime } from '../../i18n/format';
import type { PresetActions } from '../../presets/usePresetActions';
import { RADIUS } from '../../theme/tokens';
import { payloadParts } from '../../timeline/payloadSummary';
import { effectiveElapsedSeconds, isPaused } from '../../timers/pauseMath';
import { runningTimers, type RunningTimer } from '../../timers/runningTimers';
import { PauseAnnouncer, PausedClock, PauseResumeButton } from '../../timers/TimerParts';
import { TimerSheetHost } from '../../timers/TimerSheetHost';
import { TimerTarget } from '../../timers/TimerTarget';
import { useTimerCommands } from '../../timers/useTimerCommands';
import { useTimerTitle } from '../../timers/useTimerTitle';
import { palette } from '../../ui/form/styles';
import { Icon } from '../../ui/Icon';
import { illustrationKeyFor } from '../../ui/illustrations/eventKey';
import { EventIllustration } from '../../ui/illustrations/EventIllustration';
import type { ForgottenTimer } from '../timers';
import type { NowScreenModel } from '../useNow';
import { ForgottenNotice } from './ForgottenNotice';
import { NursingCard } from './NursingCard';
import type { NowAction } from './useNowAction';

/** Cards shown before the "N more" expander. */
export const RUNNING_SHOWN = 3;

interface Props {
  babyId: string;
  model: NowScreenModel;
  actions: PresetActions;
  action: NowAction;
  isSnoozed: (eventId: string) => boolean;
  onKeepRunning: (eventId: string) => void;
  /** Bigger nursing targets (the night view). */
  large?: boolean;
}

interface CardProps {
  babyId: string;
  timer: RunningTimer;
  nowMs: number;
  forgotten: ForgottenTimer | undefined;
  snoozed: boolean;
  readOnly: boolean;
  /** Who started a timer the user may not stop or pause (`EventAccess.controlLockedBy`). */
  lockedBy: string | null;
  onOpen: () => void;
  onTogglePause: () => void;
  onStop: (endedAt?: string) => void;
  onKeepRunning: (eventId: string) => void;
}

/** "120 ml", "Formula": what matters about the timer besides its name (never the name again). */
function detailOf(timer: RunningTimer, name: string): string {
  return payloadParts(timer.event.payload, timer.type)
    .map((part) => part.text)
    .filter((text) => text.toLowerCase() !== name.toLowerCase())
    .join(' · ');
}

/** The forgotten-timer note in the words of the timer kind ("Still asleep?", "Still running?"). */
function ForgottenLine({
  timer,
  name,
  forgotten,
  elapsedMs,
  disabled,
  onStop,
  onKeep,
}: {
  timer: RunningTimer;
  name: string;
  forgotten: ForgottenTimer;
  elapsedMs: number;
  disabled: boolean;
  onStop: (endedAt: string) => void;
  onKeep: () => void;
}) {
  const { t } = useTranslation();
  const duration = formatDuration(elapsedMs);
  const end = formatTime(forgotten.suggestedEnd);
  const sleep = timer.kind === 'sleep' || timer.kind === 'waking';
  const title =
    timer.kind === 'waking'
      ? t('now.forgotten.waking', { duration })
      : timer.kind === 'sleep'
        ? t('now.forgotten.asleep', {
            kind:
              timer.sleepKind === 'night'
                ? t('now.state.asleepNightLower')
                : t('now.state.asleepNapLower'),
            duration,
          })
        : t('now.forgotten.running', { name, duration });
  const art =
    timer.kind === 'waking'
      ? 'night_waking'
      : timer.kind === 'sleep'
        ? timer.sleepKind === 'night'
          ? 'night'
          : 'nap'
        : illustrationKeyFor(timer.type, timer.event.payload);
  return (
    <ForgottenNotice
      art={art}
      title={title}
      endLabel={
        sleep ? t('now.forgotten.wokeAt', { time: end }) : t('now.forgotten.stopAt', { time: end })
      }
      onEnd={() => onStop(forgotten.suggestedEnd)}
      onKeep={onKeep}
      disabled={disabled}
    />
  );
}

/**
 * One running timer as a full-width card: what runs and the detail that matters ("Bottle ·
 * 120 ml"), a large live pause-aware time, then big Pause/Resume and Stop. A paused timer turns
 * calm (raised surface, dashed edge, "Paused 02:10"). Tapping the top opens the timer sheet.
 * Readers see it without controls; a locked timer says who started it.
 */
function RunningCard({
  babyId,
  timer,
  nowMs,
  forgotten,
  snoozed,
  readOnly,
  lockedBy,
  onOpen,
  onTogglePause,
  onStop,
  onKeepRunning,
}: CardProps) {
  const { t } = useTranslation();
  const title = useTimerTitle();
  const name = title(timer);
  const detail = detailOf(timer, name);
  const paused = isPaused(timer.event);
  const elapsedMs = effectiveElapsedSeconds(timer.event, nowMs) * 1000;
  const off = readOnly || lockedBy !== null;
  return (
    <Card
      component="article"
      aria-label={name}
      data-paused={paused || undefined}
      data-testid="running-card"
      sx={(theme) => ({
        p: 2,
        ...(paused
          ? {
              backgroundColor: palette(theme).surfaceRaised,
              boxShadow: 'none',
              border: `1.5px dashed ${palette(theme).text.secondary}`,
            }
          : {}),
      })}
    >
      <PauseAnnouncer paused={paused} name={name} />
      <ButtonBase
        onClick={onOpen}
        aria-label={t('timers.mini.open', { name })}
        aria-haspopup="dialog"
        sx={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-start',
          gap: 1.5,
          textAlign: 'start',
          borderRadius: `${RADIUS.input}px`,
        }}
      >
        <EventIllustration type={timer.type} payload={timer.event.payload} size={48} />
        <Box sx={{ minWidth: 0, flex: '1 1 auto' }}>
          <Typography
            variant="subtitle1"
            component="span"
            data-testid="running-title"
            sx={{ display: 'block', fontWeight: 600, lineHeight: 1.3, overflowWrap: 'anywhere' }}
          >
            {name}
            {detail && (
              <Typography component="span" color="text.secondary" sx={{ fontWeight: 400 }}>
                {` · ${detail}`}
              </Typography>
            )}
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', columnGap: 1 }}>
            <Typography
              component="time"
              dateTime={timer.event.startedAt}
              data-testid="running-elapsed"
              sx={(theme) => ({
                fontFamily: theme.typography.fontFamilyDisplay,
                fontSize: 'clamp(2rem, 9vw, 2.5rem)',
                fontWeight: 600,
                lineHeight: 1.15,
                fontVariantNumeric: 'tabular-nums lining-nums',
                color: paused ? palette(theme).text.secondary : palette(theme).text.primary,
              })}
            >
              {formatElapsed(elapsedMs)}
            </Typography>
            {paused && <PausedClock event={timer.event} nowMs={nowMs} />}
          </Box>
        </Box>
        <Box sx={{ color: 'text.secondary', display: 'flex' }}>
          <Icon name="chevron-right" size={20} />
        </Box>
      </ButtonBase>
      {timer.kind === 'sleep' && (
        <Box sx={{ mt: 1 }}>
          <TimerTarget babyId={babyId} event={timer.event} nowMs={nowMs} />
        </Box>
      )}
      {!readOnly && (
        <Box sx={{ display: 'flex', gap: 1, mt: 1.5 }}>
          <PauseResumeButton
            paused={paused}
            name={name}
            disabled={off}
            large
            onPress={onTogglePause}
          />
          <Button
            variant="contained"
            disabled={off}
            startIcon={<Icon name="stop" size={20} />}
            aria-label={t('home.stopNamed', { name })}
            onClick={() => onStop()}
            sx={{ flex: 1, minHeight: 56, borderRadius: '999px' }}
          >
            {t('home.stop')}
          </Button>
        </Box>
      )}
      {lockedBy !== null && (
        <Box sx={{ mt: 1 }}>
          <LockedNote name={lockedBy} />
        </Box>
      )}
      {forgotten && !snoozed && (
        <Box sx={{ mt: 1.5 }}>
          <ForgottenLine
            timer={timer}
            name={name}
            forgotten={forgotten}
            elapsedMs={elapsedMs}
            disabled={off}
            onStop={(endedAt) => onStop(endedAt)}
            onKeep={() => onKeepRunning(timer.event.id)}
          />
        </Box>
      )}
    </Card>
  );
}

/**
 * "Running now" (docs/DESIGN.md, Now): every running timer at the top of the Now screen, the main
 * one first (a sleep, the nursing session, the others, a night waking). The nursing session keeps
 * its own card with the side clocks. Up to three cards, then an "N more" expander. It replaces the
 * floating mini timer bar on this screen and owns the same timer sheet.
 */
export function RunningNow({
  babyId,
  model,
  actions,
  action,
  isSnoozed,
  onKeepRunning,
  large = false,
}: Props) {
  const { t } = useTranslation();
  const nowMs = useNow(1000);
  const title = useTimerTitle();
  const commands = useTimerCommands();
  const listId = useId();
  const [expanded, setExpanded] = useState(false);
  const [sheetId, setSheetId] = useState<string | null>(null);
  const timers = runningTimers(model.running, model.types);
  if (timers.length === 0) return null;

  const shown = expanded ? timers : timers.slice(0, RUNNING_SHOWN);
  const hidden = timers.length - RUNNING_SHOWN;
  const sheetEvent: BabyEvent | undefined = timers.find((x) => x.event.id === sheetId)?.event;
  const togglePause = (event: BabyEvent) =>
    void action.run(() => (isPaused(event) ? commands.resume(event.id) : commands.pause(event.id)));

  return (
    <Box component="section" aria-label={t('home.runningTimers')}>
      <Typography
        variant="overline"
        component="h2"
        color="text.secondary"
        sx={{ display: 'block', mb: 1 }}
      >
        {t('nowLayout.running.title')}
      </Typography>
      <Stack spacing={1.5} id={listId}>
        {shown.map((timer) =>
          timer.kind === 'nursing' ? (
            <NursingCard
              key={timer.event.id}
              event={timer.event}
              commands={model.commands}
              action={action}
              readOnly={model.readOnly}
              lockedBy={model.access.controlLockedBy(timer.event)}
              large={large}
            />
          ) : (
            <RunningCard
              key={timer.event.id}
              babyId={babyId}
              timer={timer}
              nowMs={nowMs}
              forgotten={model.forgotten.get(timer.event.id)}
              snoozed={isSnoozed(timer.event.id)}
              readOnly={model.readOnly}
              lockedBy={model.access.controlLockedBy(timer.event)}
              onOpen={() => setSheetId(timer.event.id)}
              onTogglePause={() => togglePause(timer.event)}
              onStop={(endedAt) =>
                void actions.stop(timer.event, {
                  name: title(timer),
                  ...(endedAt ? { endedAt } : {}),
                })
              }
              onKeepRunning={onKeepRunning}
            />
          ),
        )}
      </Stack>
      {hidden > 0 && (
        <Button
          color="inherit"
          aria-expanded={expanded}
          aria-controls={listId}
          onClick={() => setExpanded((value) => !value)}
          endIcon={<Icon name={expanded ? 'collapse' : 'expand'} size={16} />}
          sx={{ mt: 1, minHeight: 44, width: '100%', color: 'text.secondary' }}
        >
          {expanded ? t('nowLayout.running.fewer') : t('nowLayout.running.more', { count: hidden })}
        </Button>
      )}
      <TimerSheetHost
        babyId={babyId}
        types={model.types}
        event={sheetEvent}
        readOnly={model.readOnly}
        access={model.access}
        commands={commands}
        actions={actions}
        run={(command) => void action.run(command)}
        onClose={() => setSheetId(null)}
      />
    </Box>
  );
}
