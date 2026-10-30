import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Button, IconButton, LinearProgress, Typography } from '@mui/material';
import { formatElapsed } from '../events/time';
import { formatDuration } from '../i18n/format';
import { palette } from '../ui/form/styles';
import { Icon } from '../ui/Icon';
import { currentPauseSeconds } from './pauseMath';
import type { RunningTimer } from './runningTimers';
import { targetProgress, type SleepTarget } from './targetDuration';

export interface PauseResumeButtonProps {
  paused: boolean;
  /** Timer name, for the accessible name ("Pause Nap"). */
  name: string;
  onPress: () => void;
  disabled?: boolean;
  /**
   * `icon`: a round 44 px button (bars); `text`: a labelled button that fills its row (sheets);
   * `inline`: a labelled button of its own width (cards).
   */
  variant?: 'icon' | 'text' | 'inline';
  /** Bigger touch target for the sheet. */
  large?: boolean;
}

/** Pause or Resume of a timer: the same control on every surface. */
export function PauseResumeButton({
  paused,
  name,
  onPress,
  disabled = false,
  variant = 'text',
  large = false,
}: PauseResumeButtonProps) {
  const { t } = useTranslation();
  const label = paused ? t('timers.resume') : t('timers.pause');
  const named = paused ? t('timers.resumeNamed', { name }) : t('timers.pauseNamed', { name });
  const icon = <Icon name={paused ? 'play' : 'pause'} size={variant === 'icon' ? 24 : 20} />;
  if (variant === 'icon') {
    return (
      <IconButton
        onClick={onPress}
        disabled={disabled}
        aria-label={named}
        data-testid="timer-pause-toggle"
        sx={(theme) => ({
          width: 44,
          height: 44,
          boxShadow: `inset 0 0 0 1.5px ${palette(theme).hairline}`,
          color: palette(theme).text.primary,
        })}
      >
        {icon}
      </IconButton>
    );
  }
  return (
    <Button
      variant="outlined"
      color="inherit"
      onClick={onPress}
      disabled={disabled}
      aria-label={named}
      startIcon={icon}
      data-testid="timer-pause-toggle"
      sx={
        variant === 'inline'
          ? { minHeight: 44, borderRadius: '999px', px: 2.5 }
          : { minHeight: large ? 56 : 48, flex: 1, borderRadius: '999px' }
      }
    >
      {label}
    </Button>
  );
}

/** "Paused 02:10": the open pause, live. Calm, muted accent; not an alert. */
export function PausedClock({
  event,
  nowMs,
  compact = false,
}: {
  event: RunningTimer['event'];
  nowMs: number;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const seconds = currentPauseSeconds(event, nowMs);
  return (
    <Box
      component="span"
      data-testid="timer-paused"
      sx={(theme) => ({
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.5,
        px: compact ? 0.75 : 1.25,
        py: 0.25,
        borderRadius: `${999}px`,
        fontSize: compact ? '0.75rem' : '0.875rem',
        fontWeight: 600,
        fontVariantNumeric: 'tabular-nums',
        whiteSpace: 'nowrap',
        color: palette(theme).primary.main,
        backgroundColor: `color-mix(in srgb, ${palette(theme).primary.main} 12%, transparent)`,
      })}
    >
      <Icon name="clock-pause" size={16} />
      {t('timers.pausedClock', { time: formatElapsed(seconds * 1000) })}
    </Box>
  );
}

/**
 * The quiet target of a sleep timer or a bottle: a flag with "Usual nap about 45 min" ("This bottle
 * usually takes about 12 min") and a thin progress bar.
 * Effective (pause-aware) progress; reaching the target changes the wording, never the tone.
 */
export function TargetBar({
  target,
  effectiveSeconds,
  compact = false,
}: {
  target: SleepTarget;
  effectiveSeconds: number;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const { fraction, past } = targetProgress(effectiveSeconds, target.minutes);
  const duration = formatDuration(target.minutes * 60_000);
  const caption = past
    ? t('timers.target.past')
    : target.kind === 'bottle'
      ? t('feedingAmounts.target.usualBottle', { duration })
      : t(target.kind === 'night' ? 'timers.target.usualNight' : 'timers.target.usualNap', {
          duration,
        });
  const progress = t('timers.target.progress', {
    elapsed: formatDuration(effectiveSeconds * 1000),
    target: duration,
  });
  return (
    <Box data-testid="timer-target" sx={{ minWidth: 0 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, color: 'text.secondary' }}>
        <Icon name="flag" size={16} />
        <Typography
          variant="caption"
          component="span"
          noWrap
          sx={{ fontSize: compact ? '0.75rem' : undefined }}
        >
          {caption}
        </Typography>
      </Box>
      <LinearProgress
        variant="determinate"
        value={Math.round(fraction * 100)}
        aria-label={progress}
        sx={(theme) => ({
          mt: 0.5,
          height: compact ? 4 : 6,
          borderRadius: 3,
          backgroundColor: palette(theme).surfaceRaised,
          '& .MuiLinearProgress-bar': { borderRadius: 3 },
        })}
      />
    </Box>
  );
}

/**
 * Screen-reader announcements of pause and resume (a polite live region). The first render says
 * nothing; a change is announced once, and at most every 2 s: a quicker change is announced when
 * the wait is over (with the state it has by then).
 */
export function PauseAnnouncer({ paused, name }: { paused: boolean; name: string }) {
  const { t } = useTranslation();
  const announced = useRef(paused);
  const lastAt = useRef(0);
  const [message, setMessage] = useState('');
  useEffect(() => {
    if (announced.current === paused) return;
    const wait = Math.max(0, lastAt.current + ANNOUNCE_GAP_MS - Date.now());
    const timer = window.setTimeout(() => {
      announced.current = paused;
      lastAt.current = Date.now();
      setMessage(t(paused ? 'timers.announce.paused' : 'timers.announce.resumed', { name }));
    }, wait);
    return () => window.clearTimeout(timer);
  }, [paused, name, t]);
  return (
    <Box
      role="status"
      aria-live="polite"
      sx={{
        position: 'absolute',
        width: '1px',
        height: '1px',
        overflow: 'hidden',
        clip: 'rect(0 0 0 0)',
        whiteSpace: 'nowrap',
      }}
    >
      {message}
    </Box>
  );
}

/** Announcements are spaced at least this far apart (live regions queue badly). */
const ANNOUNCE_GAP_MS = 2000;
