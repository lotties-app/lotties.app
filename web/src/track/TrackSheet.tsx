import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Drawer, Stack, Typography } from '@mui/material';
import { useEventTypes } from '../db/hooks';
import type { Baby, BabyEvent, EventType } from '../db/models';
import { QuickActions } from '../home/QuickActions';
import { presetsForBaby } from '../presets/resolve';
import type { Preset } from '../presets/types';
import { usePresetActions } from '../presets/usePresetActions';
import { usePresetEvents } from '../presets/usePresetEvents';

export interface TrackSheetProps {
  open: boolean;
  onClose: () => void;
  /** The selected baby (never a Viewer's: the FAB is hidden for them). */
  baby: Baby;
}

/**
 * The Track bottom sheet (interim version until the wave 3 redesign): every preset of the baby
 * in catalogue order as a two-column grid with its status line. A tap closes the sheet and runs
 * the preset; the Undo snackbar and any follow-up sheet outlive the drawer.
 */
export function TrackSheet({ open, onClose, baby }: TrackSheetProps) {
  const types = useEventTypes(baby.id);
  const events = usePresetEvents(baby.id);
  if (!types || !events) return null;
  return (
    <TrackSheetContent open={open} onClose={onClose} baby={baby} types={types} events={events} />
  );
}

function TrackSheetContent({
  open,
  onClose,
  baby,
  types,
  events,
}: TrackSheetProps & { types: EventType[]; events: BabyEvent[] }) {
  const { t } = useTranslation();
  const titleId = useId();
  const actions = usePresetActions(baby.id, types);
  const presets = presetsForBaby(types);

  const select = (preset: Preset, running?: BabyEvent) => {
    onClose();
    void actions.run(preset, running);
  };

  return (
    <>
      <Drawer
        anchor="bottom"
        open={open}
        onClose={onClose}
        slotProps={{ paper: { 'aria-labelledby': titleId } }}
      >
        <Stack sx={{ width: '100%', maxWidth: 480, mx: 'auto', px: 2, pb: 3, pt: 1.5 }} spacing={2}>
          <Box
            aria-hidden
            sx={{ alignSelf: 'center', width: 36, height: 4, borderRadius: 2, bgcolor: 'divider' }}
          />
          <Typography id={titleId} variant="h5" component="h2">
            {t('track.title')}
          </Typography>
          {presets.length === 0 ? (
            <Typography color="text.secondary">{t('home.noTypes')}</Typography>
          ) : (
            <QuickActions presets={presets} events={events} onSelect={select} columns={{ xs: 2 }} />
          )}
        </Stack>
      </Drawer>
      {actions.elements}
    </>
  );
}
