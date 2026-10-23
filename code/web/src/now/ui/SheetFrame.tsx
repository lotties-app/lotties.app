import { useId, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Drawer, IconButton, Stack, Typography } from '@mui/material';
import { CONTENT_MAX_WIDTH } from '../../theme/tokens';
import { Icon } from '../../ui/Icon';

export interface SheetFrameProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** A quiet line under the title ("Last: 12:02 · bottle 120 ml"). */
  subtitle?: string;
  /** Icon or stamp before the title. */
  leading?: ReactNode;
  /** Takes the whole screen height on phones (long content scrolls inside). */
  fullHeight?: boolean;
  children: ReactNode;
}

/** Full height on phones, at most the screen height elsewhere; the paper scrolls. */
const FULL_HEIGHT = {
  height: { xs: 'calc(100dvh - 16px)', sm: 'auto' },
  maxHeight: 'calc(100dvh - 16px)',
} as const;

/**
 * The bottom sheet of the Now trays and the Why sheet: a handle, a titled header with a close
 * button, then the content. Named by its title; Esc, the scrim and the close button dismiss it.
 */
export function SheetFrame({
  open,
  onClose,
  title,
  subtitle,
  leading,
  fullHeight = false,
  children,
}: SheetFrameProps) {
  const { t } = useTranslation();
  const titleId = useId();
  return (
    <Drawer
      anchor="bottom"
      open={open}
      onClose={onClose}
      slotProps={{
        paper: {
          'aria-labelledby': titleId,
          sx: {
            maxWidth: CONTENT_MAX_WIDTH,
            mx: 'auto',
            width: '100%',
            ...(fullHeight ? FULL_HEIGHT : {}),
          },
        },
      }}
    >
      <Stack
        spacing={2}
        sx={{ px: 2.5, pt: 1.5, pb: 'calc(24px + env(safe-area-inset-bottom))', minWidth: 0 }}
      >
        <Box
          aria-hidden
          sx={{ alignSelf: 'center', width: 36, height: 4, borderRadius: 2, bgcolor: 'divider' }}
        />
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
          {leading}
          <Box sx={{ flexGrow: 1, minWidth: 0 }}>
            <Typography id={titleId} variant="h5" component="h2">
              {title}
            </Typography>
            {subtitle && (
              <Typography variant="caption" color="text.secondary" component="p">
                {subtitle}
              </Typography>
            )}
          </Box>
          <IconButton onClick={onClose} aria-label={t('now.sheet.close')} edge="end">
            <Icon name="close" />
          </IconButton>
        </Stack>
        {children}
      </Stack>
    </Drawer>
  );
}
