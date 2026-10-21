import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Button, Card, Chip, LinearProgress, Typography } from '@mui/material';
import { formatDuration, formatTime } from '../../i18n/format';
import type { PredictionConfidence, PredictionDto } from '../../sync/contract';
import { RADIUS, type CategoryName } from '../../theme/tokens';
import { palette } from '../../ui/form/styles';
import { Icon } from '../../ui/Icon';
import type { IconName } from '../../ui/icons';
import type { AsleepState, AwakeState, LearningState, NapWindow, NightWaking } from '../nowState';
import { sleepActionLabel } from '../nowText';
import type { SleepAction, SleepActionKind } from '../sleepToggle';
import type { NowScreenModel } from '../useNow';
import { DayRuler } from './DayRuler';
import { ForgottenNotice } from './ForgottenNotice';
import type { NowAction } from './useNowAction';
import { WhySheet } from './WhySheet';

const MINUTE_MS = 60_000;

const ACTION_ICON: Record<SleepActionKind, IconName> = {
  fell_asleep: 'moon',
  bedtime: 'moon-stars',
  woke_up: 'sun',
  night_waking: 'eye',
  up_for_the_day: 'sun',
  back_asleep: 'moon',
};

const CONFIDENCE_LABEL = {
  High: 'predictions.confidence.high',
  Medium: 'predictions.confidence.medium',
  Low: 'predictions.confidence.low',
} as const satisfies Record<PredictionConfidence, string>;

export interface StateCardProps {
  model: NowScreenModel;
  babyName: string;
  action: NowAction;
  /** The full sleep prediction (typical length), for the Why sheet. */
  prediction?: PredictionDto;
  /** Ends a forgotten timer at the suggested time. */
  onEndAt: (eventId: string, endedAt: string) => void;
  isSnoozed: (eventId: string) => boolean;
  onKeepRunning: (eventId: string) => void;
}

/** Tinted pill with the state ("Awake", "Asleep · Nap"). */
function StatePill({
  category,
  icon,
  label,
}: {
  category: CategoryName;
  icon: IconName;
  label: string;
}) {
  return (
    <Box
      sx={(theme) => ({
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.75,
        py: 0.5,
        pl: 0.75,
        pr: 1.5,
        borderRadius: `${RADIUS.pill}px`,
        fontSize: '0.8125rem',
        fontWeight: 600,
        backgroundColor: palette(theme).category[category].bg,
        color: palette(theme).category[category].fg,
      })}
    >
      <Icon name={icon} size={20} />
      {label}
    </Box>
  );
}

function NapWindowBlock({
  state,
  window,
  now,
  onWhy,
}: {
  state: AwakeState;
  window: NapWindow;
  now: Date;
  onWhy: () => void;
}) {
  const { t } = useTranslation();
  const nowMs = now.getTime();
  const earliest = Date.parse(window.earliest);
  const status =
    nowMs < earliest
      ? t('now.nap.opensIn', { duration: formatDuration(earliest - nowMs) })
      : nowMs <= Date.parse(window.latest)
        ? t('now.nap.open')
        : t('now.nap.past');
  return (
    <Box
      sx={(theme) => ({
        mt: 2,
        p: 1.5,
        borderRadius: `${RADIUS.input}px`,
        backgroundColor: palette(theme).surfaceRaised,
      })}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        <Typography variant="subtitle2" component="h3" sx={{ flexGrow: 1 }}>
          {t('now.nap.title')}
        </Typography>
        <Chip size="small" label={t(CONFIDENCE_LABEL[window.confidence])} />
        <Button size="small" onClick={onWhy} sx={{ minHeight: 44, minWidth: 44 }}>
          {t('predictions.why')}
        </Button>
      </Box>
      <Typography variant="body1" sx={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
        {t('now.nap.range', { from: formatTime(window.earliest), to: formatTime(window.latest) })}
        <Typography component="span" color="text.secondary" sx={{ fontWeight: 400 }}>
          {` · ${status}`}
        </Typography>
      </Typography>
      <DayRuler
        since={state.since}
        now={now}
        window={{ earliest: window.earliest, latest: window.latest }}
      />
    </Box>
  );
}

function LearningBlock({ learning, babyName }: { learning: LearningState; babyName: string }) {
  const { t } = useTranslation();
  const { sampleCount, requiredSamples } = learning;
  const progress =
    sampleCount !== null && requiredSamples !== null && requiredSamples > 0
      ? { done: sampleCount, total: requiredSamples }
      : null;
  return (
    <Box
      sx={(theme) => ({
        mt: 2,
        p: 1.5,
        borderRadius: `${RADIUS.input}px`,
        backgroundColor: palette(theme).surfaceRaised,
      })}
    >
      <Typography variant="subtitle2" component="h3">
        {t('now.learning.title', { name: babyName })}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {learning.reason === 'stale' ? t('now.learning.stale') : t('now.learning.body')}
      </Typography>
      {progress && (
        <Box sx={{ mt: 1 }}>
          <LinearProgress
            variant="determinate"
            value={Math.round(Math.min(100, (progress.done / progress.total) * 100))}
            aria-label={t('now.learning.progress', progress)}
            sx={{ height: 6, borderRadius: 3 }}
          />
          <Typography variant="caption" color="text.secondary">
            {t('now.learning.progress', progress)}
          </Typography>
        </Box>
      )}
    </Box>
  );
}

function SleepButtons({
  actions,
  onRun,
  disabled,
}: {
  actions: SleepAction[];
  onRun: (kind: SleepActionKind) => void;
  disabled: boolean;
}) {
  const [primary, ...others] = actions;
  if (!primary) return null;
  return (
    <>
      <Button
        variant="contained"
        size="large"
        fullWidth
        disabled={disabled}
        startIcon={<Icon name={ACTION_ICON[primary.kind]} size={24} />}
        onClick={() => onRun(primary.kind)}
        sx={{ mt: 2, minHeight: 64, fontSize: '1.0625rem' }}
      >
        {sleepActionLabel(primary.kind)}
      </Button>
      {others.length > 0 && (
        <Box sx={{ display: 'flex', justifyContent: 'center', gap: 1, mt: 1, flexWrap: 'wrap' }}>
          {others.map((other) => (
            <Button
              key={other.kind}
              color="inherit"
              disabled={disabled}
              onClick={() => onRun(other.kind)}
              sx={{ minHeight: 44, color: 'text.secondary' }}
            >
              {sleepActionLabel(other.kind)}
            </Button>
          ))}
        </Box>
      )}
    </>
  );
}

function AskBlock({
  babyName,
  onRun,
  disabled,
}: {
  babyName: string;
  onRun: (kind: SleepActionKind) => void;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const options = [
    { kind: 'fell_asleep', category: 'sleep', icon: 'moon', label: t('now.ask.sleeping') },
    { kind: 'woke_up', category: 'care', icon: 'sun', label: t('now.ask.awake') },
  ] as const;
  return (
    <Box sx={{ textAlign: 'center' }}>
      <Typography variant="h5" component="h2">
        {t('now.ask.title', { name: babyName })}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {t('now.ask.hint')}
      </Typography>
      <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5, mt: 2 }}>
        {options.map((option) => (
          <Box
            key={option.kind}
            component="button"
            type="button"
            disabled={disabled}
            onClick={() => onRun(option.kind)}
            sx={(theme) => ({
              appearance: 'none',
              border: 0,
              font: 'inherit',
              fontWeight: 600,
              cursor: 'pointer',
              minHeight: 104,
              borderRadius: `${RADIUS.tile}px`,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 0.75,
              backgroundColor: palette(theme).category[option.category].bg,
              color: palette(theme).category[option.category].fg,
              '&:focus-visible': {
                outline: `2px solid ${palette(theme).primary.main}`,
                outlineOffset: 2,
              },
              '&:disabled': { opacity: 0.5, cursor: 'not-allowed' },
            })}
          >
            <Icon name={option.icon} size={32} />
            {option.label}
          </Box>
        ))}
      </Box>
    </Box>
  );
}

function AsleepBlock({ state }: { state: AsleepState }) {
  const { t } = useTranslation();
  const waking: NightWaking | undefined = state.nightWaking;
  const minutes = waking ? waking.minutes : state.minutes;
  const sinceLine = waking
    ? t('now.state.wakingSince', {
        time: formatTime(waking.since),
        sleepTime: formatTime(state.since),
      })
    : t('now.state.since', { time: formatTime(state.since) });
  return (
    <>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
        {waking ? (
          <StatePill category="nightWaking" icon="eye" label={t('now.state.nightWaking')} />
        ) : (
          <StatePill
            category="sleep"
            icon="moon"
            label={
              state.sleepKind === 'night' ? t('now.state.asleepNight') : t('now.state.asleepNap')
            }
          />
        )}
        <Typography variant="caption" color="text.secondary" sx={{ textAlign: 'right' }}>
          {sinceLine}
        </Typography>
      </Box>
      <Typography variant="hero" component="p" data-testid="state-duration" sx={{ mt: 1 }}>
        {formatDuration(minutes * MINUTE_MS)}
      </Typography>
    </>
  );
}

/**
 * The state card (docs/design/mockups/01-now.html): awake or asleep with a live duration, the nap
 * window on a day ruler (or what the app is still learning), and the one big action that changes
 * the state, with the quiet secondary one.
 */
export function StateCard({
  model,
  babyName,
  action,
  prediction,
  onEndAt,
  isSnoozed,
  onKeepRunning,
}: StateCardProps) {
  const { t } = useTranslation();
  const [whyOpen, setWhyOpen] = useState(false);
  const { state, now } = model;
  const disabled = model.readOnly;
  const run = (kind: SleepActionKind) =>
    void action.run(() =>
      model.commands.sleep(kind, state.kind === 'asleep' ? undefined : state.sleepKindHint),
    );

  const forgotten =
    state.kind === 'asleep' ? (state.nightWaking?.forgotten ?? state.forgotten) : undefined;
  const forgottenEventId =
    state.kind === 'asleep' ? (state.nightWaking?.eventId ?? state.eventId) : '';

  return (
    <Card component="section" aria-label={t('now.state.region')} sx={{ p: 2.5 }}>
      {state.kind === 'unknown' ? (
        <AskBlock babyName={babyName} onRun={run} disabled={disabled} />
      ) : state.kind === 'awake' ? (
        <>
          <Box
            sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}
          >
            <StatePill category="care" icon="sun" label={t('now.state.awake')} />
            <Typography variant="caption" color="text.secondary" sx={{ textAlign: 'right' }}>
              {state.after === 'nap'
                ? t('now.state.sinceAfterNap', { time: formatTime(state.since) })
                : state.after === 'night'
                  ? t('now.state.sinceAfterNight', { time: formatTime(state.since) })
                  : t('now.state.since', { time: formatTime(state.since) })}
            </Typography>
          </Box>
          <Typography variant="hero" component="p" data-testid="state-duration" sx={{ mt: 1 }}>
            {formatDuration(state.awakeMinutes * MINUTE_MS)}
          </Typography>
          {state.window ? (
            <>
              <NapWindowBlock
                state={state}
                window={state.window}
                now={now}
                onWhy={() => setWhyOpen(true)}
              />
              <WhySheet
                open={whyOpen}
                onClose={() => setWhyOpen(false)}
                window={state.window}
                prediction={prediction}
              />
            </>
          ) : state.learning ? (
            <LearningBlock learning={state.learning} babyName={babyName} />
          ) : null}
        </>
      ) : (
        <AsleepBlock state={state} />
      )}

      {forgotten && !isSnoozed(forgottenEventId) && state.kind === 'asleep' && (
        <Box sx={{ mt: 2 }}>
          <ForgottenNotice
            title={
              state.nightWaking
                ? t('now.forgotten.waking', {
                    duration: formatDuration(state.nightWaking.minutes * MINUTE_MS),
                  })
                : t('now.forgotten.asleep', {
                    kind:
                      state.sleepKind === 'night'
                        ? t('now.state.asleepNightLower')
                        : t('now.state.asleepNapLower'),
                    duration: formatDuration(state.minutes * MINUTE_MS),
                  })
            }
            endLabel={t('now.forgotten.wokeAt', { time: formatTime(forgotten.suggestedEnd) })}
            onEnd={() => onEndAt(forgottenEventId, forgotten.suggestedEnd)}
            onKeep={() => onKeepRunning(forgottenEventId)}
            disabled={model.readOnly}
          />
        </Box>
      )}

      {state.kind !== 'unknown' && (
        <SleepButtons actions={model.sleepActions} onRun={run} disabled={disabled} />
      )}
    </Card>
  );
}
