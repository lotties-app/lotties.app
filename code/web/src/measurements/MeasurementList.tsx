import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { IconButton, List, ListItem, ListItemText, Stack } from '@mui/material';
import { formatDate, formatNumber } from '../i18n/format';
import { doctorLabel } from '../professional/doctorLabel';
import { fromPersonDto, type MeasurementDto } from '../sync/contract';
import { METRICS, metricLabel, sortNewestFirst } from './measurementModel';
import { Icon } from '../ui/Icon';

const dateLabel = (date: string) => formatDate(date);

function valuesText(t: TFunction, m: MeasurementDto): string {
  return METRICS.filter((metric) => m[metric.key] !== null)
    .map((metric) =>
      t('growth.valueWithUnit', {
        label: metricLabel(metric),
        value: formatNumber(m[metric.key] as number),
        unit: metric.unit,
      }),
    )
    .join(' · ');
}

/** "Recorded by Dr. Ana Souza (self-declared)" for a Doctor's consultation measurement. */
function recordedByText(t: TFunction, m: MeasurementDto): string | null {
  const person = m.recordedByDoctor ? fromPersonDto(m.recordedBy) : null;
  if (!m.recordedByDoctor) return null;
  if (!person) return t('doctor.growth.recordedByDoctor');
  return t('doctor.growth.recordedBy', { name: doctorLabel(t, person) });
}

interface Props {
  measurements: MeasurementDto[];
  /** Whether the user may edit and delete this one (parents and owners: any; the Doctor: her own). */
  canChange: (m: MeasurementDto) => boolean;
  onEdit: (m: MeasurementDto) => void;
  onDelete: (m: MeasurementDto) => void;
}

/**
 * Measurements, newest date first, each with who recorded it when it was the baby's Doctor. Edit
 * and delete appear for parents and owners, and for the Doctor on her own.
 */
export function MeasurementList({ measurements, canChange, onEdit, onDelete }: Props) {
  const { t } = useTranslation();
  return (
    <List aria-label={t('growth.list')} disablePadding>
      {sortNewestFirst(measurements).map((m) => {
        const writable = canChange(m);
        return (
          <ListItem
            key={m.id}
            divider
            secondaryAction={
              writable && (
                <Stack direction="row">
                  <IconButton
                    aria-label={t('growth.editOn', { date: dateLabel(m.date) })}
                    onClick={() => onEdit(m)}
                  >
                    <Icon name="edit" />
                  </IconButton>
                  <IconButton
                    aria-label={t('growth.deleteOn', { date: dateLabel(m.date) })}
                    onClick={() => onDelete(m)}
                  >
                    <Icon name="delete" />
                  </IconButton>
                </Stack>
              )
            }
          >
            <ListItemText
              primary={dateLabel(m.date)}
              secondary={[valuesText(t, m), m.notes, recordedByText(t, m)]
                .filter(Boolean)
                .join(' — ')}
              sx={{ pr: writable ? 11 : 0 }}
            />
          </ListItem>
        );
      })}
    </List>
  );
}
