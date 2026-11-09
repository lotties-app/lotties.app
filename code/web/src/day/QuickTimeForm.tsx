import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Button, Typography } from '@mui/material';
import { describeApiError } from '../api/errorMessages';
import { useDatabase } from '../db/DatabaseContext';
import { editEvent } from '../db/eventCommands';
import type { BabyEvent } from '../db/models';
import { editFollowingWakeUp } from '../now/nightEndsWakeUp';
import { ClockTimeField, Field } from '../ui/form';
import {
  atClock,
  clockOf,
  isMomentEntry,
  nudged,
  quickTimeChanges,
  quickTimeProblem,
} from './quickTime';

const NUDGES = [-15, -5, 5, 15] as const;

interface Props {
  event: BabyEvent;
  onSaved: () => void;
  onCancel: () => void;
}

/** One time of the entry: the native time input and the -15/-5/+5/+15 minute chips. */
function TimeRow({
  label,
  value,
  error,
  onChange,
}: {
  label: string;
  value: Date;
  error?: string;
  onChange: (next: Date) => void;
}) {
  const { t } = useTranslation();
  return (
    <Field label={label} {...(error ? { error } : {})}>
      <ClockTimeField
        value={clockOf(value)}
        onChange={(hhmm) => {
          const next = atClock(value, hhmm);
          if (next) onChange(next);
        }}
      />
      <Box
        role="group"
        aria-label={t('day.quickTime.nudges', { field: label })}
        sx={{ display: 'flex', gap: 1, mt: 1 }}
      >
        {NUDGES.map((minutes) => (
          <Button
            key={minutes}
            variant="outlined"
            size="small"
            onClick={() => onChange(nudged(value, minutes))}
            aria-label={t(minutes < 0 ? 'day.quickTime.earlier' : 'day.quickTime.later', {
              field: label,
              count: Math.abs(minutes),
            })}
            sx={{ flex: '1 1 0', minWidth: 0, minHeight: 44, borderRadius: '999px' }}
          >
            {minutes < 0 ? `−${-minutes}` : `+${minutes}`}
          </Button>
        ))}
      </Box>
    </Field>
  );
}

/**
 * The quick time sheet of a Day row: the start (and the end when the entry has its own end), each
 * with the native time input and nudge chips, then Cancel and Save. Saving is a normal edit of the
 * event's times (client `updatedAt`, idempotent upsert, a night's wake-up kept in step); the payload
 * is untouched, which is why only entries `quickTimeAllowed` lets through come here.
 */
export function QuickTimeForm({ event, onSaved, onCancel }: Props) {
  const { t } = useTranslation();
  const db = useDatabase();
  const running = event.endedAt === null;
  const hasEnd = !running && !isMomentEntry(event);
  const [start, setStart] = useState(() => new Date(event.startedAt));
  const [end, setEnd] = useState(() => (hasEnd ? new Date(event.endedAt!) : null));
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const found = quickTimeProblem(start, end, running, new Date());
    if (found) {
      setProblem(
        found === 'endBeforeStart'
          ? t('events.validation.endBeforeStart')
          : t('day.quickTime.startInFuture'),
      );
      return;
    }
    setSaving(true);
    try {
      const changes = quickTimeChanges(event, start, end);
      await editFollowingWakeUp(db, event, () => editEvent(db, event.id, changes));
      onSaved();
    } catch (error) {
      setProblem(describeApiError(error));
      setSaving(false);
    }
  };

  const edit = (apply: () => void) => {
    setProblem(null);
    apply();
  };

  return (
    <Box sx={{ display: 'grid', gap: 2.5 }}>
      <TimeRow
        label={hasEnd ? t('events.start') : t('events.time')}
        value={start}
        onChange={(next) => edit(() => setStart(next))}
      />
      {end && (
        <TimeRow
          label={t('events.end')}
          value={end}
          onChange={(next) => edit(() => setEnd(next))}
        />
      )}
      {problem && (
        <Typography role="alert" color="error" variant="body2">
          {problem}
        </Typography>
      )}
      <Box sx={{ display: 'flex', gap: 1 }}>
        <Button
          variant="outlined"
          onClick={onCancel}
          sx={{ flex: '1 1 0', minHeight: 48, borderRadius: '999px' }}
        >
          {t('common.cancel')}
        </Button>
        <Button
          variant="contained"
          disabled={saving}
          onClick={() => void save()}
          sx={{ flex: '1 1 0', minHeight: 48, borderRadius: '999px' }}
        >
          {t('common.save')}
        </Button>
      </Box>
    </Box>
  );
}
