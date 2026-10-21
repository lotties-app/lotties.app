import { useTranslation } from 'react-i18next';
import { Box, Drawer, Stack, Typography } from '@mui/material';
import type { Baby } from '../db/models';

export interface TrackSheetProps {
  open: boolean;
  onClose: () => void;
  /** The selected baby (never a Viewer's: the FAB is hidden for them). */
  baby: Baby;
}

/**
 * Placeholder for the Track bottom sheet (docs/DESIGN.md section 5). Part B replaces the body with
 * the preset tile grid; the props are the contract the app shell relies on.
 */
export function TrackSheet({ open, onClose }: TrackSheetProps) {
  const { t } = useTranslation();
  return (
    <Drawer anchor="bottom" open={open} onClose={onClose} aria-label={t('track.title')}>
      <Stack sx={{ width: '100%', maxWidth: 480, mx: 'auto', px: 2, pb: 3, pt: 1.5 }} spacing={2}>
        <Box
          aria-hidden
          sx={{
            alignSelf: 'center',
            width: 36,
            height: 4,
            borderRadius: 2,
            bgcolor: 'divider',
          }}
        />
        <Typography variant="h5" component="h2">
          {t('track.title')}
        </Typography>
        <Typography color="text.secondary">{t('track.placeholder')}</Typography>
      </Stack>
    </Drawer>
  );
}
