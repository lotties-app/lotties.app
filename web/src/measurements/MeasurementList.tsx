import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { IconButton, List, ListItem, ListItemText, Stack } from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import { formatDate, formatNumber } from '../i18n/format';
import type { MeasurementDto } from '../sync/contract';
import { METRICS, metricLabel, sortNewestFirst } from './measurementModel';

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

interface Props {
  measurements: MeasurementDto[];
  writable: boolean;
  onEdit: (m: MeasurementDto) => void;
  onDelete: (m: MeasurementDto) => void;
}

/** Measurements, newest date first. Edit and delete only appear for parents and owners. */
export function MeasurementList({ measurements, writable, onEdit, onDelete }: Props) {
  const { t } = useTranslation();
  return (
    <List aria-label={t('growth.list')} disablePadding>
      {sortNewestFirst(measurements).map((m) => (
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
                  <EditIcon />
                </IconButton>
                <IconButton
                  aria-label={t('growth.deleteOn', { date: dateLabel(m.date) })}
                  onClick={() => onDelete(m)}
                >
                  <DeleteIcon />
                </IconButton>
              </Stack>
            )
          }
        >
          <ListItemText
            primary={dateLabel(m.date)}
            secondary={[valuesText(t, m), m.notes].filter(Boolean).join(' — ')}
            sx={{ pr: writable ? 11 : 0 }}
          />
        </ListItem>
      ))}
    </List>
  );
}
