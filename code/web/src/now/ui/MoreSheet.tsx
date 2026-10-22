import { useTranslation } from 'react-i18next';
import { Box, Typography } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import type { BabyEvent, EventType } from '../../db/models';
import { PresetTile } from '../../presets/PresetTile';
import { presetsForBaby } from '../../presets/resolve';
import type { Preset } from '../../presets/types';
import type { PresetActions } from '../../presets/usePresetActions';
import { usePresetStates } from '../../presets/usePresetEvents';
import { SheetFrame } from './SheetFrame';
import type { TrayName } from './trays';

interface Props {
  open: boolean;
  onClose: () => void;
  types: readonly EventType[];
  events: readonly BabyEvent[];
  actions: PresetActions;
  readOnly: boolean;
  /** Presets with their own tray open it instead of running (Diaper, Meds, Belly pain). */
  onOpenTray: (tray: TrayName) => void;
  /** Nursing starts the live timer through the Now commands. */
  onStartNursing: () => void;
}

/** The Bottle preset is a timer (start, then stop with the amount), so it runs like the others. */
const TRAY_OF_PRESET: Readonly<Record<string, TrayName>> = {
  diaper: 'diaper',
  medication: 'meds',
  belly_pain: 'bellyPain',
};

/**
 * The More sheet: every preset of the baby as a two-column grid with its status line, so nothing
 * the baby can track is more than two taps away. Sleep presets stay here as data kinds; the
 * toggle on Now is the everyday way.
 */
export function MoreSheet({
  open,
  onClose,
  types,
  events,
  actions,
  readOnly,
  onOpenTray,
  onStartNursing,
}: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const stateOf = usePresetStates(events);
  const presets = presetsForBaby([...types]);

  const select = (preset: Preset, running?: BabyEvent) => {
    onClose();
    if (preset.mode === 'link') {
      if (preset.href) navigate(preset.href);
      return;
    }
    const tray = TRAY_OF_PRESET[preset.id];
    if (tray) onOpenTray(tray);
    else if (preset.id === 'nursing' && !running) onStartNursing();
    else if (preset.id === 'nursing') onOpenTray('feed');
    else void actions.run(preset, running);
  };

  return (
    <SheetFrame open={open} onClose={onClose} title={t('now.more.title')}>
      {presets.length === 0 ? (
        <Typography color="text.secondary">{t('home.noTypes')}</Typography>
      ) : (
        <Box
          data-testid="more-grid"
          sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 1.5 }}
        >
          {presets.map((preset) => {
            const { status, running } = stateOf(preset);
            return (
              <PresetTile
                key={preset.id}
                preset={preset}
                status={status || undefined}
                running={running !== undefined}
                disabled={readOnly && preset.mode !== 'link'}
                onClick={() => select(preset, running)}
              />
            );
          })}
        </Box>
      )}
    </SheetFrame>
  );
}
