import { Box, ButtonBase, Typography } from '@mui/material';
import type { EventType } from '../db/models';
import { EventTypeIcon } from '../events/eventIcons';
import { safeColor } from '../events/safeColor';

interface Props {
  types: EventType[];
  /** Duration types that already have a running timer. */
  runningTypeIds: ReadonlySet<string>;
  onSelect: (type: EventType) => void;
}

function QuickAction({
  type,
  running,
  onSelect,
}: {
  type: EventType;
  running: boolean;
  onSelect: (type: EventType) => void;
}) {
  const color = safeColor(type.color);
  return (
    <ButtonBase
      onClick={() => onSelect(type)}
      disabled={running}
      aria-label={type.hasDuration ? `Start ${type.name}` : `Log ${type.name}`}
      sx={{
        minHeight: 96,
        borderRadius: 2,
        border: 1,
        borderColor: color ?? 'divider',
        flexDirection: 'column',
        gap: 0.5,
        p: 1,
        '&.Mui-disabled': { opacity: 0.5 },
      }}
    >
      <EventTypeIcon name={type.icon} color={color} fontSize={36} />
      <Typography variant="subtitle1" component="span">
        {type.name}
      </Typography>
      {running && (
        <Typography variant="caption" component="span">
          Running
        </Typography>
      )}
    </ButtonBase>
  );
}

export function QuickActions({ types, runningTypeIds, onSelect }: Props) {
  return (
    <Box
      sx={{
        display: 'grid',
        gap: 1.5,
        gridTemplateColumns: { xs: 'repeat(2, 1fr)', sm: 'repeat(3, 1fr)', md: 'repeat(4, 1fr)' },
      }}
    >
      {types.map((type) => (
        <QuickAction
          key={type.id}
          type={type}
          running={type.hasDuration && runningTypeIds.has(type.id)}
          onSelect={onSelect}
        />
      ))}
    </Box>
  );
}
