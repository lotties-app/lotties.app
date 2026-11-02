import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Button, ButtonBase, Stack, Typography } from '@mui/material';
import type { BabyEvent, EventPayload } from '../db/models';
import { formatDuration, formatTime } from '../i18n/format';
import { ClockTimeField, Field } from '../ui/form';
import { QuantityStepper } from '../units/QuantityStepper';
import { useUnits } from '../units/useUnits';
import { BottleLevelChips } from './BottleLevelChips';
import {
  addPause,
  canReshape,
  historyRows,
  removePause,
  setRowLevel,
  setRowTime,
  type HistoryEdit,
  type HistoryEditProblem,
  type HistoryRow,
} from './bottleHistory';
import { MAX_LEVEL_ML } from './bottleSegments';

type Bottle = Pick<BabyEvent, 'startedAt' | 'endedAt' | 'payload'>;

const LEVEL_STEP_ML = 10;
const MINUTE = 60_000;
const pad = (n: number) => String(n).padStart(2, '0');

/** `HH:MM` (local) of an instant. */
const clockOf = (ms: number) => {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** The instant of `HH:MM` on the day of `reference`, the next day when that falls before `notBefore`. */
function instantOf(clock: string, reference: number, notBefore: number): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(clock);
  if (!match) return null;
  const d = new Date(reference);
  d.setHours(Number(match[1]), Number(match[2]), 0, 0);
  const ms = d.getTime();
  return ms < notBefore - MINUTE ? ms + 24 * 60 * MINUTE : ms;
}

const ROW_LABEL = {
  start: 'feedingAmounts.history.start',
  pause: 'feedingAmounts.history.pause',
  resume: 'feedingAmounts.history.resume',
  end: 'feedingAmounts.history.end',
} as const;

interface Props {
  /** The bottle as the history reads it (stored times, edited payload). */
  bottle: Bottle;
  preparedMl: number | null;
  /** The time now (ms): where an added pause of a running bottle may go up to. */
  nowMs: number;
  /** Rows can be changed, pauses added and removed. */
  editable: boolean;
  /** A new history (segments and pause keys). */
  onChange?: (payload: EventPayload) => void;
  /**
   * The level at the end of an ended bottle (its end row, or its last pause when it stopped
   * paused): the sheet sets the drunk total from it, so the totals and the history agree.
   */
  onEndLevel?: (levelMl: number) => void;
}

function LevelControls({
  preparedMl,
  ceilingMl,
  value,
  onChange,
}: {
  preparedMl: number | null;
  ceilingMl: number | null;
  value: number | null;
  onChange: (ml: number) => void;
}) {
  const { t } = useTranslation();
  return (
    <Stack spacing={1}>
      <BottleLevelChips
        aria-label={t('feedingAmounts.history.level')}
        preparedMl={preparedMl}
        ceilingMl={ceilingMl}
        value={value}
        onChange={onChange}
      />
      <QuantityStepper
        quantity="volume"
        aria-label={t('feedingAmounts.history.otherLevel')}
        value={value}
        onChange={(next) => next !== null && onChange(Math.round(next))}
        step={LEVEL_STEP_ML}
        min={0}
        max={ceilingMl ?? preparedMl ?? MAX_LEVEL_ML}
        unit="ml"
      />
    </Stack>
  );
}

/**
 * "History" of a timed bottle (docs/design/44-bottle-history.md): start, each pause with what was
 * left and drunk, each resume, the end, newest last. Editable: a row opens its time and level
 * (the same chips and stepper as the pause question); a pause can be removed and one added in a
 * gap. Every edit is checked as the API will and refused with the reason; the totals are
 * recomputed from the history.
 */
export function BottleHistory({
  bottle,
  preparedMl,
  nowMs,
  editable,
  onChange,
  onEndLevel,
}: Props) {
  const { t } = useTranslation();
  const units = useUnits();
  const [open, setOpen] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [problem, setProblem] = useState<HistoryEditProblem | null>(null);
  const rows = historyRows(bottle);
  const reshape = editable && canReshape(bottle);
  const startMs = Date.parse(bottle.startedAt);
  const endMs = bottle.endedAt === null ? nowMs : Date.parse(bottle.endedAt);

  const apply = (edit: HistoryEdit) => {
    if ('problem' in edit) {
      setProblem(edit.problem);
      return false;
    }
    setProblem(null);
    onChange?.(edit.payload);
    return true;
  };

  const lastIndex = rows.reduce((max, row) => Math.max(max, row.index), 0);
  const setsTotal = (row: HistoryRow) =>
    bottle.endedAt !== null &&
    (row.kind === 'end' || (row.kind === 'pause' && row.index === lastIndex)) &&
    preparedMl !== null;

  const changeLevel = (row: HistoryRow, ml: number) => {
    if (row.kind === 'end' && rows.length <= 2 && setsTotal(row)) {
      onEndLevel?.(ml);
      return;
    }
    if (apply(setRowLevel(bottle, row, ml)) && setsTotal(row)) onEndLevel?.(ml);
  };

  const describe = (row: HistoryRow) => {
    const parts: string[] = [];
    if (row.levelMl === null) parts.push(t('feedingAmounts.history.levelUnknown'));
    else if (row.kind === 'start' || row.kind === 'resume') {
      parts.push(t('feedingAmounts.history.levelIn', { ml: units.formatVolume(row.levelMl) }));
    } else {
      parts.push(t('feedingAmounts.history.levelLeft', { ml: units.formatVolume(row.levelMl) }));
    }
    if (row.drunkMl !== null && row.drunkMl > 0) {
      parts.push(t('feedingAmounts.history.drank', { ml: units.formatVolume(row.drunkMl) }));
    }
    if (row.open) parts.push(t('feedingAmounts.history.drinkingNow'));
    return parts.join(' · ');
  };

  return (
    <Stack spacing={1} data-field-key="segments">
      <Typography variant="overline" component="h3" color="text.secondary">
        {t('feedingAmounts.history.title')}
      </Typography>
      <Stack component="ol" spacing={0.5} sx={{ listStyle: 'none', m: 0, p: 0 }}>
        {rows.map((row, i) => {
          const label = t(ROW_LABEL[row.kind]);
          const time =
            row.atMs === null ? t('feedingAmounts.history.timeUnknown') : formatTime(row.atMs);
          const rowEditable =
            editable && (row.kind === 'pause' || row.kind === 'resume' || row.kind === 'end');
          const content = (
            <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'baseline', width: '100%' }}>
              <Box
                component="span"
                sx={{ minWidth: 56, fontVariantNumeric: 'lining-nums tabular-nums' }}
              >
                {time}
              </Box>
              <Box component="span" sx={{ fontWeight: 600, minWidth: 72 }}>
                {label}
              </Box>
              <Box component="span" sx={{ color: 'text.secondary', overflowWrap: 'anywhere' }}>
                {describe(row)}
              </Box>
            </Box>
          );
          return (
            <Box component="li" key={`${row.kind}-${row.index}`}>
              {rowEditable ? (
                <ButtonBase
                  onClick={() => {
                    setOpen(open === i ? null : i);
                    setAdding(false);
                    setProblem(null);
                  }}
                  aria-expanded={open === i}
                  aria-label={t('feedingAmounts.history.editRow', { row: `${label} ${time}` })}
                  sx={{
                    minHeight: 44,
                    width: '100%',
                    justifyContent: 'flex-start',
                    textAlign: 'left',
                    borderRadius: 1,
                    px: 0.5,
                  }}
                >
                  {content}
                </ButtonBase>
              ) : (
                <Box sx={{ minHeight: 44, display: 'flex', alignItems: 'center', px: 0.5 }}>
                  {content}
                </Box>
              )}
              {open === i && rowEditable && (
                <Stack spacing={1.5} sx={{ pl: 1, pr: 0.5, py: 1 }}>
                  {row.kind !== 'end' && (
                    <Field label={t('feedingAmounts.history.time')}>
                      <ClockTimeField
                        value={row.atMs === null ? '' : clockOf(row.atMs)}
                        onChange={(clock) => {
                          const at = instantOf(clock, row.atMs ?? startMs, startMs);
                          if (at !== null) apply(setRowTime(bottle, row, at));
                        }}
                      />
                    </Field>
                  )}
                  {row.kind !== 'resume' && (
                    <Field
                      label={t('feedingAmounts.history.level')}
                      group
                      {...(setsTotal(row) ? { help: t('feedingAmounts.history.endLevelHint') } : {})}
                    >
                      <LevelControls
                        preparedMl={preparedMl}
                        ceilingMl={rows[i - 1]?.levelMl ?? null}
                        value={row.levelMl}
                        onChange={(ml) => changeLevel(row, ml)}
                      />
                    </Field>
                  )}
                  <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                    {reshape && row.kind === 'pause' && (
                      <Button
                        color="error"
                        onClick={() => {
                          if (apply(removePause(bottle, row.index))) setOpen(null);
                        }}
                        sx={{ minHeight: 44 }}
                      >
                        {t('feedingAmounts.history.remove')}
                      </Button>
                    )}
                    <Button onClick={() => setOpen(null)} sx={{ minHeight: 44, ml: 'auto' }}>
                      {t('feedingAmounts.history.done')}
                    </Button>
                  </Box>
                </Stack>
              )}
            </Box>
          );
        })}
      </Stack>
      {reshape &&
        (adding ? (
          <AddPauseForm
            preparedMl={preparedMl}
            startMs={startMs}
            endMs={endMs}
            onCancel={() => {
              setAdding(false);
              setProblem(null);
            }}
            onAdd={(pauseAt, resumeAt, level) => {
              if (apply(addPause(bottle, pauseAt, resumeAt, level))) setAdding(false);
            }}
          />
        ) : (
          <Button
            onClick={() => {
              setAdding(true);
              setOpen(null);
              setProblem(null);
            }}
            sx={{ minHeight: 44, alignSelf: 'flex-start' }}
          >
            {t('feedingAmounts.history.add')}
          </Button>
        ))}
      {problem && (
        <Typography role="alert" variant="body2" color="error">
          {t(`feedingAmounts.history.problem.${problem}`)}
        </Typography>
      )}
    </Stack>
  );
}

function AddPauseForm({
  preparedMl,
  startMs,
  endMs,
  onCancel,
  onAdd,
}: {
  preparedMl: number | null;
  startMs: number;
  endMs: number;
  onCancel: () => void;
  onAdd: (pauseAt: number, resumeAt: number, levelMl: number | null) => void;
}) {
  const { t } = useTranslation();
  const middle = startMs + Math.floor((endMs - startMs) / 2 / MINUTE) * MINUTE;
  const [pauseClock, setPauseClock] = useState(clockOf(middle));
  const [resumeClock, setResumeClock] = useState(clockOf(Math.min(endMs, middle + MINUTE)));
  const [level, setLevel] = useState<number | null>(null);
  const pauseAt = instantOf(pauseClock, startMs, startMs);
  const resumeAt = instantOf(resumeClock, startMs, startMs);
  return (
    <Stack spacing={1.5} sx={{ pl: 1, py: 1 }}>
      <Field label={t('feedingAmounts.history.pausedAt')}>
        <ClockTimeField value={pauseClock} onChange={setPauseClock} />
      </Field>
      <Field label={t('feedingAmounts.history.resumedAt')}>
        <ClockTimeField value={resumeClock} onChange={setResumeClock} />
      </Field>
      <Field label={t('feedingAmounts.history.level')} group optional>
        <LevelControls preparedMl={preparedMl} ceilingMl={null} value={level} onChange={setLevel} />
      </Field>
      <Box sx={{ display: 'flex', gap: 1 }}>
        <Button onClick={onCancel} sx={{ minHeight: 44, flex: 1 }}>
          {t('feedingAmounts.history.cancel')}
        </Button>
        <Button
          variant="outlined"
          disabled={pauseAt === null || resumeAt === null}
          onClick={() => pauseAt !== null && resumeAt !== null && onAdd(pauseAt, resumeAt, level)}
          sx={{ minHeight: 44, flex: 1 }}
        >
          {t('feedingAmounts.history.addConfirm')}
        </Button>
      </Box>
    </Stack>
  );
}

/** The live totals of the history above the Save button: drunk, pauses, paused and drinking time. */
export function BottleHistoryTotals({
  drunkMl,
  pauseCount,
  pausedSeconds,
  drinkingSeconds,
}: {
  drunkMl: number | null;
  pauseCount: number;
  pausedSeconds: number;
  drinkingSeconds: number;
}) {
  const { t } = useTranslation();
  const units = useUnits();
  const parts = [
    ...(drunkMl === null
      ? []
      : [t('feedingAmounts.history.totalDrunk', { ml: units.formatVolume(drunkMl) })]),
    t('feedingAmounts.history.totalPauses', { count: pauseCount }),
    t('feedingAmounts.history.totalPaused', { duration: formatDuration(pausedSeconds * 1000) }),
    t('feedingAmounts.history.totalDrinking', {
      duration: formatDuration(drinkingSeconds * 1000),
    }),
  ];
  return (
    <Typography variant="body2" color="text.secondary" aria-live="polite">
      {parts.join(' · ')}
    </Typography>
  );
}
