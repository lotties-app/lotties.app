import { useState, type ReactNode } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { Box, Button, ButtonBase, Card, Chip, LinearProgress, Typography } from '@mui/material';
import { formatDuration, formatTime } from '../../i18n/format';
import type {
  BedTimeDto,
  PredictionConfidence,
  PredictionDto,
  PredictionsDto,
} from '../../sync/contract';
import { RADIUS, type CategoryName } from '../../theme/tokens';
import { palette } from '../../ui/form/styles';
import { Icon } from '../../ui/Icon';
import type { IconName } from '../../ui/icons';
import { Illustration } from '../../ui/illustrations';
import type { AsleepState, AwakeState, LearningState, NapWindow, NightWaking } from '../nowState';
import { sleepActionLabel } from '../nowText';
import { LockedNote } from '../../baby/LockedNote';
import { typeForKey } from '../eventFacts';
import {
  changesRunningSleep,
  runningSleepLock,
  type SleepAction,
  type SleepActionKind,
} from '../sleepToggle';
import type { NowScreenModel } from '../useNow';
import { napWindowKey, readSkippedNap, writeSkippedNap } from '../napGuidance';
import { overtiredDismissal } from '../dismissalStore';
import { projectNaps, type NapProjection } from '../napProjection';
import { overtiredSuggestion, wakeWindowOf } from '../overtired';
import type { RhythmNow } from '../rhythmDetails';
import { readNowView, writeNowView, type NowView } from '../ringPrefs';
import { DayRing } from './DayRing';
import { DayRuler } from './DayRuler';
import { NapSheet } from './NapSheet';
import { RhythmCollapse } from './RhythmCollapse';
import { RhythmToggle } from './RhythmToggle';
import type { NowAction } from './useNowAction';
import { BedtimeLine } from './BedtimeLine';
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
  /** Keys the skipped nap prediction. */
  babyId: string;
  babyName: string;
  action: NowAction;
  /** The full sleep prediction (typical length), for the Why sheet. */
  prediction?: PredictionDto;
  /** The next night's start (heuristic v1.1), when the server sent one. */
  bedTime?: BedTimeDto | null;
  /** The predictions response: the overtired heads-up gives the "now" face its tired look. */
  predictions?: PredictionsDto;
}

/** What the ring and the ruler need to describe "now" beyond the window. */
interface RhythmFacts {
  overtired: boolean;
  bedTime: { earliest: string; latest: string } | null;
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

/**
 * The top of the state card: the state pill, the live duration in the serif numerals and the
 * "since" line on the left, the illustration of the state (96 px, soft glow in light and dark) on
 * the right. The drawing is decoration: the pill and the numbers carry the meaning.
 */
function StateHero({
  illustration,
  pill,
  duration,
  since,
}: {
  illustration: string;
  pill: ReactNode;
  duration: string;
  since: string;
}) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
      <Box sx={{ minWidth: 0 }}>
        {pill}
        <Typography
          variant="hero"
          component="p"
          data-testid="state-duration"
          sx={{ mt: 0.75, fontSize: 'clamp(2rem, 9vw, 2.5rem)', overflowWrap: 'anywhere' }}
        >
          {duration}
        </Typography>
        <Typography variant="caption" color="text.secondary" component="p">
          {since}
        </Typography>
      </Box>
      <Illustration name={illustration} size={64} glow />
    </Box>
  );
}

/**
 * The nap window as one compact line: "Nap window 21:30–22:26 · opens in 40m", the confidence, a
 * tap for the details sheet and "Why?". The ruler or ring lives in the folding part below.
 */
function NapWindowLine({
  window,
  now,
  onWhy,
  onOpen,
}: {
  window: NapWindow;
  now: Date;
  onWhy: () => void;
  onOpen: () => void;
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
        mt: 1.5,
        py: 0.5,
        pl: 1.5,
        pr: 0.5,
        borderRadius: `${RADIUS.input}px`,
        backgroundColor: palette(theme).surfaceRaised,
        display: 'flex',
        alignItems: 'center',
        gap: 0.5,
      })}
    >
      <ButtonBase
        onClick={onOpen}
        aria-label={t('now.nap.openDetails', {
          from: formatTime(window.earliest),
          to: formatTime(window.latest),
        })}
        aria-haspopup="dialog"
        sx={{
          flex: '1 1 auto',
          minWidth: 0,
          minHeight: 44,
          justifyContent: 'flex-start',
          textAlign: 'start',
          borderRadius: `${RADIUS.input}px`,
        }}
      >
        <Typography variant="body2" component="span" sx={{ display: 'block', minWidth: 0 }}>
          <Box component="span" sx={{ fontWeight: 600 }}>
            <span>{t('now.nap.title')}</span>{' '}
            <Box component="span" sx={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
              {t('now.nap.range', {
                from: formatTime(window.earliest),
                to: formatTime(window.latest),
              })}
            </Box>
          </Box>
          <Box component="span" sx={{ color: 'text.secondary' }}>
            {` · ${status} `}
          </Box>
          <Chip
            size="small"
            component="span"
            label={t(CONFIDENCE_LABEL[window.confidence])}
            sx={{ height: 22, fontSize: '0.75rem', verticalAlign: 'middle' }}
          />
        </Typography>
      </ButtonBase>
      <Button size="small" onClick={onWhy} sx={{ minHeight: 44, minWidth: 44, flexShrink: 0 }}>
        {t('predictions.why')}
      </Button>
    </Box>
  );
}

/** The ruler of the awake window, or the ring, with the toggle between them. */
function RhythmView({
  state,
  window,
  now,
  view,
  onView,
  ring,
  facts,
  projection,
}: {
  state: AwakeState;
  window: NapWindow;
  now: Date;
  view: NowView;
  onView: (view: NowView) => void;
  ring: ReactNode;
  facts: RhythmFacts;
  projection: NapProjection | null;
}) {
  return (
    <>
      {view === 'ring' ? (
        ring
      ) : (
        <DayRuler
          since={state.since}
          now={now}
          window={{ earliest: window.earliest, latest: window.latest, basis: window.basis }}
          minutes={state.awakeMinutes}
          overtired={facts.overtired}
          bedTime={facts.bedTime}
          projection={projection}
        />
      )}
      <RhythmToggle view={view} onChange={onView} />
    </>
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
        mt: 1.5,
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
  lockedBy = null,
}: {
  actions: SleepAction[];
  onRun: (kind: SleepActionKind) => void;
  disabled: boolean;
  /** Who started the running sleep the user may not change (see `runningSleepLock`). */
  lockedBy?: string | null;
}) {
  const [primary, ...others] = actions;
  if (!primary) return null;
  const off = (kind: SleepActionKind) =>
    disabled || (lockedBy !== null && changesRunningSleep(kind));
  const locked = !disabled && lockedBy !== null && actions.some((a) => changesRunningSleep(a.kind));
  return (
    <>
      <Button
        variant="contained"
        size="large"
        fullWidth
        disabled={off(primary.kind)}
        startIcon={<Icon name={ACTION_ICON[primary.kind]} size={24} />}
        onClick={() => onRun(primary.kind)}
        sx={{ mt: 1.5, minHeight: 56, fontSize: '1.0625rem' }}
      >
        {sleepActionLabel(primary.kind)}
      </Button>
      {others.length > 0 && (
        <Box sx={{ display: 'flex', justifyContent: 'center', gap: 1, mt: 1, flexWrap: 'wrap' }}>
          {others.map((other) => (
            <Button
              key={other.kind}
              color="inherit"
              disabled={off(other.kind)}
              onClick={() => onRun(other.kind)}
              sx={{ minHeight: 44, color: 'text.secondary' }}
            >
              {sleepActionLabel(other.kind)}
            </Button>
          ))}
        </Box>
      )}
      {locked && (
        <Box sx={{ mt: 1 }}>
          <LockedNote name={lockedBy} />
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
    { kind: 'fell_asleep', category: 'sleep', art: 'fell_asleep', label: t('now.ask.sleeping') },
    { kind: 'woke_up', category: 'care', art: 'woke_up', label: t('now.ask.awake') },
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
            <Illustration name={option.art} size={64} />
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
  const illustration = waking ? 'night_waking' : state.sleepKind === 'night' ? 'night' : 'nap';
  return (
    <StateHero
      illustration={illustration}
      pill={
        waking ? (
          <StatePill category="nightWaking" icon="eye" label={t('now.state.nightWaking')} />
        ) : (
          <StatePill
            category="sleep"
            icon="moon"
            label={
              state.sleepKind === 'night' ? t('now.state.asleepNight') : t('now.state.asleepNap')
            }
          />
        )
      }
      duration={formatDuration(minutes * MINUTE_MS)}
      since={sinceLine}
    />
  );
}

/** "Asleep · Nap" / "Night waking" for the middle of the ring. */
function asleepLabel(state: AsleepState, t: TFunction): string {
  if (state.nightWaking) return t('now.state.nightWaking');
  return state.sleepKind === 'night' ? t('now.state.asleepNight') : t('now.state.asleepNap');
}

const asleepMinutes = (state: AsleepState) => state.nightWaking?.minutes ?? state.minutes;

/** "Now" for the ring and the ruler: a running night waking is awake time in the night. */
function rhythmNow(state: AwakeState | AsleepState): RhythmNow {
  if (state.kind === 'awake') {
    return { kind: 'awake', since: state.since, minutes: state.awakeMinutes };
  }
  if (state.nightWaking) {
    return { kind: 'waking', since: state.nightWaking.since, minutes: state.nightWaking.minutes };
  }
  return { kind: 'asleep', since: state.since, minutes: state.minutes };
}

/**
 * The state card (docs/design/mockups/01-now.html, compact since the "Running now" layout): awake
 * or asleep with a live duration, the nap window as one line (or what the app is still learning),
 * the bedtime line, the one big action that changes the state with the quiet secondary ones, and
 * the day ruler or ring folded below (`RhythmCollapse`). Running timers have their own cards above.
 */
export function StateCard({
  model,
  babyId,
  babyName,
  action,
  prediction,
  bedTime,
  predictions,
}: StateCardProps) {
  const { t } = useTranslation();
  const [whyOpen, setWhyOpen] = useState(false);
  const [napOpen, setNapOpen] = useState(false);
  const [view, setViewState] = useState<NowView>(readNowView);
  const [skipped, setSkipped] = useState(() => readSkippedNap(babyId));
  const { state, now } = model;
  const setView = (next: NowView) => {
    setViewState(next);
    writeNowView(next);
  };
  const skipNap = (key: string | null) => {
    setSkipped(key);
    writeSkippedNap(babyId, key);
  };
  const disabled = model.readOnly;
  const sleepLock = runningSleepLock(
    model.running,
    typeForKey(model.types, 'sleep')?.id,
    model.access.controlLockedBy,
  );
  const run = (kind: SleepActionKind) =>
    void action.run(() =>
      model.commands.sleep(kind, state.kind === 'asleep' ? undefined : state.sleepKindHint),
    );

  const facts: RhythmFacts = {
    // The heads-up as its card shows it (the same "Not now" for this awake stretch).
    overtired:
      overtiredSuggestion({
        predictions,
        state,
        events: model.events,
        types: model.types,
        now,
        dismissedSince: overtiredDismissal.read(babyId),
      }) !== null,
    bedTime: bedTime
      ? { earliest: bedTime.nextStart.earliest, latest: bedTime.nextStart.latest }
      : null,
  };

  /**
   * The naps still likely today: after the shown nap window while awake (none once it is
   * skipped), after the running nap while asleep (none in the night or a night waking).
   */
  const projectionFor = (current: AwakeState | AsleepState, window?: NapWindow) => {
    const shared = {
      events: model.events,
      types: model.types,
      now,
      wakeWindowMinutes: wakeWindowOf(predictions)?.limitMinutes ?? null,
      bedTime: facts.bedTime,
    };
    if (current.kind === 'awake') {
      if (!window) return null;
      return projectNaps({
        ...shared,
        state: { kind: 'awake', since: current.since },
        prediction: {
          nextStart: window,
          basis: window.basis,
          expectedDuration: prediction?.expectedDuration ?? null,
        },
      });
    }
    if (current.nightWaking || !prediction) return null;
    return projectNaps({
      ...shared,
      state: { kind: 'asleep', since: current.since, sleepKind: current.sleepKind },
      prediction,
    });
  };

  const ringFor = (
    current: AwakeState | AsleepState,
    stateLabel: string,
    duration: string,
    window?: NapWindow,
  ) => (
    <DayRing
      events={model.events}
      types={model.types}
      now={now}
      {...(window
        ? { window: { earliest: window.earliest, latest: window.latest, basis: window.basis } }
        : {})}
      stateLabel={stateLabel}
      duration={duration}
      state={rhythmNow(current)}
      overtired={facts.overtired}
      bedTime={facts.bedTime}
      projection={projectionFor(current, window)}
    />
  );

  const sleepButtons = state.kind !== 'unknown' && (
    <SleepButtons
      actions={model.sleepActions}
      onRun={run}
      disabled={disabled}
      lockedBy={sleepLock}
    />
  );

  if (state.kind === 'unknown') {
    return (
      <Card component="section" aria-label={t('now.state.region')} sx={{ p: 2 }}>
        <AskBlock babyName={babyName} onRun={run} disabled={disabled} />
      </Card>
    );
  }

  if (state.kind === 'asleep') {
    return (
      <Card component="section" aria-label={t('now.state.region')} sx={{ p: 2 }}>
        <AsleepBlock state={state} />
        {sleepButtons}
        <RhythmCollapse>
          {ringFor(state, asleepLabel(state, t), formatDuration(asleepMinutes(state) * MINUTE_MS))}
        </RhythmCollapse>
      </Card>
    );
  }

  const awakeDuration = formatDuration(state.awakeMinutes * MINUTE_MS);
  const window = state.window && napWindowKey(state.window) !== skipped ? state.window : null;
  return (
    <Card component="section" aria-label={t('now.state.region')} sx={{ p: 2 }}>
      <StateHero
        illustration="woke_up"
        pill={<StatePill category="care" icon="sun" label={t('now.state.awake')} />}
        duration={awakeDuration}
        since={
          state.after === 'nap'
            ? t('now.state.sinceAfterNap', { time: formatTime(state.since) })
            : state.after === 'night'
              ? t('now.state.sinceAfterNight', { time: formatTime(state.since) })
              : t('now.state.since', { time: formatTime(state.since) })
        }
      />
      {window ? (
        <>
          <NapWindowLine
            window={window}
            now={now}
            onWhy={() => setWhyOpen(true)}
            onOpen={() => setNapOpen(true)}
          />
          <WhySheet
            open={whyOpen}
            onClose={() => setWhyOpen(false)}
            window={window}
            prediction={prediction}
          />
          <NapSheet
            open={napOpen}
            onClose={() => setNapOpen(false)}
            window={window}
            {...(prediction?.expectedDuration
              ? { expectedMinutes: prediction.expectedDuration.minutes }
              : {})}
            now={now}
            readOnly={model.readOnly}
            onSkip={() => {
              setNapOpen(false);
              skipNap(napWindowKey(window));
            }}
            onLog={() => {
              setNapOpen(false);
              run('fell_asleep');
            }}
          />
        </>
      ) : state.window ? (
        <Box
          sx={(theme) => ({
            mt: 1.5,
            py: 0.5,
            pl: 1.5,
            pr: 0.5,
            borderRadius: `${RADIUS.input}px`,
            backgroundColor: palette(theme).surfaceRaised,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 1,
          })}
        >
          <Typography variant="body2" color="text.secondary">
            {t('now.napSheet.skipped')}
          </Typography>
          <Button size="small" onClick={() => skipNap(null)} sx={{ minHeight: 44 }}>
            {t('now.napSheet.show')}
          </Button>
        </Box>
      ) : null}
      {bedTime && <BedtimeLine bedTime={bedTime} now={now} />}
      {state.learning && <LearningBlock learning={state.learning} babyName={babyName} />}
      {sleepButtons}
      <RhythmCollapse>
        {window ? (
          <RhythmView
            state={state}
            window={window}
            now={now}
            view={view}
            onView={setView}
            ring={ringFor(state, t('now.state.awake'), awakeDuration, window)}
            facts={facts}
            projection={projectionFor(state, window)}
          />
        ) : (
          ringFor(state, t('now.state.awake'), awakeDuration)
        )}
      </RhythmCollapse>
    </Card>
  );
}
