import { IconButton, List, ListItem, ListItemText, Stack } from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import type { MeasurementDto } from '../sync/contract';
import { METRICS, sortNewestFirst } from './measurementModel';

const dateLabel = (date: string) =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });

function valuesText(m: MeasurementDto): string {
  return METRICS.filter((metric) => m[metric.key] !== null)
    .map((metric) => `${metric.label} ${m[metric.key]} ${metric.unit}`)
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
  return (
    <List aria-label="Measurements" disablePadding>
      {sortNewestFirst(measurements).map((m) => (
        <ListItem
          key={m.id}
          divider
          secondaryAction={
            writable && (
              <Stack direction="row">
                <IconButton
                  aria-label={`Edit measurement of ${dateLabel(m.date)}`}
                  onClick={() => onEdit(m)}
                >
                  <EditIcon />
                </IconButton>
                <IconButton
                  aria-label={`Delete measurement of ${dateLabel(m.date)}`}
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
            secondary={[valuesText(m), m.notes].filter(Boolean).join(' — ')}
            sx={{ pr: writable ? 11 : 0 }}
          />
        </ListItem>
      ))}
    </List>
  );
}
