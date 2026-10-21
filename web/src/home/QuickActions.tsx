import { Box } from '@mui/material';
import type { BabyEvent } from '../db/models';
import { PresetTile } from '../presets/PresetTile';
import type { Preset } from '../presets/types';
import { usePresetStates } from '../presets/usePresetEvents';

interface Props {
  presets: readonly Preset[];
  /** Recent and running events of the baby (status lines). */
  events: readonly BabyEvent[];
  onSelect: (preset: Preset, running?: BabyEvent) => void;
  /** Viewers cannot log events. */
  readOnly?: boolean;
  /** Grid columns per breakpoint (Home: 2/3/4; the Track sheet: 2). */
  columns?: { xs: number; sm?: number; md?: number };
}

const HOME_COLUMNS = { xs: 2, sm: 3, md: 4 };

/** A grid of preset tiles with their status lines ("Last 2h ago", "Running 0:42"). */
export function QuickActions({
  presets,
  events,
  onSelect,
  readOnly = false,
  columns = HOME_COLUMNS,
}: Props) {
  const stateOf = usePresetStates(events);
  const template = (count: number | undefined) =>
    count === undefined ? undefined : `repeat(${count}, minmax(0, 1fr))`;
  return (
    <Box
      data-testid="quick-actions"
      sx={{
        display: 'grid',
        gap: 1.5,
        gridTemplateColumns: {
          xs: template(columns.xs),
          sm: template(columns.sm),
          md: template(columns.md),
        },
      }}
    >
      {presets.map((preset) => {
        const { status, running } = stateOf(preset);
        return (
          <PresetTile
            key={preset.id}
            preset={preset}
            status={status || undefined}
            running={running !== undefined}
            disabled={readOnly}
            onClick={() => onSelect(preset, running)}
          />
        );
      })}
    </Box>
  );
}
