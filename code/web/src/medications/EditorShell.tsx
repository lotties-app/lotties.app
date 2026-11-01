import type { ReactNode, Ref } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Box,
  Button,
  CircularProgress,
  Dialog,
  Drawer,
  IconButton,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import { Icon } from '../ui/Icon';
import { palette } from '../ui/form/styles';

/*
 * The shell shared by the prescription editor, the proposal editor and the proposal details: a
 * bottom sheet on a phone and a dialog on a desktop, with a title row, a scrolling body and a
 * footer that stays in view.
 */

/** A bottom sheet below the `md` breakpoint, a dialog above it; named by the element `titleId`. */
export function EditorFrame({
  titleId,
  onClose,
  children,
}: {
  titleId: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const theme = useTheme();
  const desktop = useMediaQuery(theme.breakpoints.up('md'));
  if (desktop) {
    return (
      <Dialog
        open
        onClose={onClose}
        fullWidth
        maxWidth="sm"
        aria-labelledby={titleId}
        slotProps={{
          paper: {
            sx: {
              display: 'flex',
              flexDirection: 'column',
              maxHeight: 'min(760px, calc(100dvh - 64px))',
            },
          },
        }}
      >
        {children}
      </Dialog>
    );
  }
  return (
    <Drawer
      anchor="bottom"
      open
      onClose={onClose}
      slotProps={{
        paper: {
          'aria-labelledby': titleId,
          sx: {
            display: 'flex',
            flexDirection: 'column',
            height: 'auto',
            maxHeight: 'calc(100dvh - 16px)',
            borderTopLeftRadius: 20,
            borderTopRightRadius: 20,
          },
        },
      }}
    >
      {children}
    </Drawer>
  );
}

/** The title row with the close button; `leading` is an icon or stamp before the title. */
export function EditorHeader({
  titleId,
  title,
  onClose,
  leading,
  children,
}: {
  titleId: string;
  title: string;
  onClose: () => void;
  leading?: ReactNode;
  /** A quiet line under the title. */
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 2.5, pt: 2, pb: 1 }}>
      {leading}
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography id={titleId} variant="h5" component="h2" sx={{ overflowWrap: 'anywhere' }}>
          {title}
        </Typography>
        {children}
      </Box>
      <IconButton onClick={onClose} aria-label={t('now.sheet.close')} edge="end">
        <Icon name="close" />
      </IconButton>
    </Box>
  );
}

/** The scrolling part between the title row and the footer. */
export function EditorBody({ ref, children }: { ref?: Ref<HTMLDivElement>; children: ReactNode }) {
  return (
    <Box
      ref={ref}
      sx={{
        flex: '1 1 auto',
        overflowY: 'auto',
        px: 2.5,
        pb: 2,
        display: 'flex',
        flexDirection: 'column',
        gap: 3,
        '& > *': { flexShrink: 0 },
      }}
    >
      {children}
    </Box>
  );
}

/** The footer that stays in view: a hairline above it, the safe-area inset below. */
export function EditorFooter({ children }: { children: ReactNode }) {
  return (
    <Box
      sx={{
        flex: '0 0 auto',
        borderTop: 1,
        borderColor: 'divider',
        px: 2.5,
        pt: 1.5,
        pb: 'calc(16px + env(safe-area-inset-bottom))',
        display: 'grid',
        gap: 1.25,
      }}
    >
      {children}
    </Box>
  );
}

/** The one-line plain-language rule at the top of an editor or a details sheet. */
export function PlainSummary({ text }: { text: string | null }) {
  const { t } = useTranslation();
  return (
    <Box
      role="status"
      aria-live="polite"
      sx={(theme) => ({
        borderRadius: '18px',
        p: 1.75,
        backgroundColor: palette(theme).surfaceRaised,
        color: text ? palette(theme).text.primary : palette(theme).text.secondary,
      })}
    >
      <Box
        component="span"
        sx={{ display: 'block', fontSize: '0.75rem', color: 'text.secondary', mb: 0.5 }}
      >
        {t('medications.editor.summaryLabel')}
      </Box>
      <Typography sx={{ fontWeight: text ? 600 : 400 }}>
        {text ?? t('medications.editor.summaryEmpty')}
      </Typography>
    </Box>
  );
}

/** "Discard your changes?" with Keep editing and Discard, in the footer of a dirty editor. */
export function DiscardChoice({
  onKeep,
  onDiscard,
}: {
  onKeep: () => void;
  onDiscard: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Box
      role="group"
      aria-label={t('events.sheet.discardQuestion')}
      sx={{ display: 'grid', gap: 1.5 }}
    >
      <Typography sx={{ fontWeight: 600 }}>{t('events.sheet.discardQuestion')}</Typography>
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
        <Button
          variant="outlined"
          autoFocus
          onClick={onKeep}
          sx={{ flex: '1 1 140px', minHeight: 48, borderRadius: '999px' }}
        >
          {t('events.sheet.keepEditing')}
        </Button>
        <Button
          color="error"
          variant="outlined"
          onClick={onDiscard}
          sx={{ flex: '1 1 140px', minHeight: 48, borderRadius: '999px' }}
        >
          {t('events.sheet.discard')}
        </Button>
      </Box>
    </Box>
  );
}

/** The big pill button of an editor footer, with a spinner while saving. */
export function PrimaryAction({
  label,
  saving,
  onClick,
}: {
  label: string;
  saving: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      variant="contained"
      fullWidth
      onClick={onClick}
      aria-busy={saving || undefined}
      startIcon={saving ? <CircularProgress size={20} color="inherit" aria-hidden /> : undefined}
      sx={{ minHeight: 56, borderRadius: '999px', fontSize: '1rem' }}
    >
      {label}
    </Button>
  );
}
