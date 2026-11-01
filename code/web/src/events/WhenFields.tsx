import { useTranslation } from 'react-i18next';
import { Box } from '@mui/material';
import type { EventType } from '../db/models';
import { formatDuration } from '../i18n/format';
import { Icon } from '../ui/Icon';
import { Field, TimePanel } from '../ui/form';
import { fromLocalInput, toLocalInput } from './time';
import type { EventFormState } from './formModel';

interface Props {
  type: EventType | undefined;
  form: Pick<EventFormState, 'startedAt' | 'endedAt'>;
  /** "Now" of the quick chips and the ruler: when the sheet opened. */
  now: Date;
  errors: Readonly<Record<string, string>>;
  onChange: (changes: Partial<Pick<EventFormState, 'startedAt' | 'endedAt'>>) => void;
  /** Solid food or a bedtime marker: one time, no End and no timer. */
  instant?: boolean;
}

const toDate = (local: string) => {
  const iso = fromLocalInput(local);
  return iso ? new Date(iso) : null;
};
const toLocal = (date: Date | null) => (date ? toLocalInput(date.toISOString()) : '');

/**
 * The "When" part of the sheet: the inline time panel for the time of an instant event, or Start
 * and End panels (with the live duration between them and a "Still running" switch) for a timer.
 */
export function WhenFields({ type, form, now, errors, onChange, instant = false }: Props) {
  const { t } = useTranslation();
  const start = toDate(form.startedAt);
  const end = toDate(form.endedAt);
  const hasDuration = type?.hasDuration === true && !instant;

  if (!hasDuration) {
    return (
      <Box data-field-key="start">
        <Field label={t('events.time')} error={errors.start}>
          <TimePanel
            compact
            value={start ?? now}
            now={now}
            onChange={(d) => onChange({ startedAt: toLocal(d) })}
          />
        </Field>
      </Box>
    );
  }
  return (
    <Box sx={{ display: 'grid', gap: 3 }}>
      <Box data-field-key="start">
        <Field label={t('events.start')} error={errors.start}>
          <TimePanel
            compact
            value={start ?? now}
            now={now}
            onChange={(d) => onChange({ startedAt: toLocal(d) })}
          />
        </Field>
      </Box>
      <Box data-field-key="end">
        <Field label={t('events.end')} error={errors.end}>
          <TimePanel
            compact
            value={end}
            now={now}
            min={start}
            allowRunning
            onChange={(d) => onChange({ endedAt: toLocal(d) })}
          />
        </Field>
        {/* No "0 min" for an event that ends when it starts (an older instant bottle). */}
        {start && end && end > start && (
          <Box
            role="status"
            sx={{
              mt: 1,
              display: 'flex',
              alignItems: 'center',
              gap: 0.75,
              fontSize: '0.875rem',
              color: 'text.secondary',
            }}
          >
            <Icon name="stopwatch" size={16} />
            {t('events.sheet.duration', {
              duration: formatDuration(end.getTime() - start.getTime()),
            })}
          </Box>
        )}
      </Box>
    </Box>
  );
}
