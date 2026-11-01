import { useTranslation } from 'react-i18next';
import { Box, Button, IconButton } from '@mui/material';
import { Icon } from '../ui/Icon';
import { ClockTimeField } from '../ui/form/ClockTimeField';
import { useControlAttributes } from '../ui/form/fieldContext';
import { MAX_TIMES } from './prescriptionForm';

interface Props {
  /** `HH:mm` local times, in the order shown. */
  value: string[];
  onChange: (value: string[]) => void;
  disabled?: boolean;
}

/** A time 4 hours after the last one (or 08:00), a quick start for the next row. */
function nextTime(times: readonly string[]): string {
  const last = times.at(-1);
  if (!last) return '08:00';
  const [h, m] = last.split(':').map(Number);
  return `${String((h + 4) % 24).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** The clock times of a scheduled prescription: one native time input per row, add and remove. */
export function TimesOfDayField({ value, onChange, disabled = false }: Props) {
  const { t } = useTranslation();
  const { disabled: fieldDisabled, ...control } = useControlAttributes();
  const off = disabled || fieldDisabled;
  const setAt = (index: number, time: string) =>
    onChange(value.map((current, i) => (i === index ? time : current)));

  return (
    <Box sx={{ display: 'grid', gap: 1 }}>
      {value.map((time, index) => (
        <Box key={index} sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <ClockTimeField
              value={time}
              disabled={off}
              id={index === 0 ? control.id : `${control.id ?? 'time-of-day'}-${index + 1}`}
              aria-label={t('medications.editor.timeN', { n: index + 1 })}
              onChange={(next) => setAt(index, next)}
            />
          </Box>
          <IconButton
            disabled={off}
            aria-label={t('medications.editor.removeTimeN', { n: index + 1 })}
            onClick={() => onChange(value.filter((_, i) => i !== index))}
            sx={{ width: 48, height: 48 }}
          >
            <Icon name="close" />
          </IconButton>
        </Box>
      ))}
      <Button
        variant="outlined"
        disabled={off || value.length >= MAX_TIMES}
        startIcon={<Icon name="add" size={20} />}
        onClick={() => onChange([...value, nextTime(value)])}
        sx={{ minHeight: 48, justifySelf: 'start', borderRadius: '999px' }}
      >
        {t('medications.editor.addTime')}
      </Button>
    </Box>
  );
}
