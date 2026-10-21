import { useTranslation } from 'react-i18next';
import { Chip, Stack } from '@mui/material';
import type { EventType } from '../db/models';
import { EventTypeIcon } from '../events/eventIcons';
import { safeColor } from '../events/safeColor';
import { useEventTypeText } from '../i18n/eventTypeText';

interface Props {
  types: EventType[];
  /** Selected type ids; empty = all types. */
  selected: ReadonlySet<string>;
  onChange: (next: ReadonlySet<string>) => void;
}

function toggled(selected: ReadonlySet<string>, id: string): ReadonlySet<string> {
  const next = new Set(selected);
  if (!next.delete(id)) next.add(id);
  return next;
}

/** "All" plus one toggle chip per event type; several types can be combined. */
export function TimelineFilters({ types, selected, onChange }: Props) {
  const { t } = useTranslation();
  const names = useEventTypeText();
  return (
    <Stack
      direction="row"
      spacing={1}
      role="group"
      aria-label={t('timeline.filterByType')}
      sx={{ overflowX: 'auto', pb: 0.5 }}
    >
      <Chip
        label={t('timeline.all')}
        color={selected.size === 0 ? 'primary' : 'default'}
        variant={selected.size === 0 ? 'filled' : 'outlined'}
        aria-pressed={selected.size === 0}
        onClick={() => onChange(new Set())}
      />
      {types.map((type) => {
        const active = selected.has(type.id);
        return (
          <Chip
            key={type.id}
            label={names.typeName(type)}
            icon={<EventTypeIcon name={type.icon} color={safeColor(type.color)} size={20} />}
            color={active ? 'primary' : 'default'}
            variant={active ? 'filled' : 'outlined'}
            aria-pressed={active}
            onClick={() => onChange(toggled(selected, type.id))}
          />
        );
      })}
    </Stack>
  );
}
