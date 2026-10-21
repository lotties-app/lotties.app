import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent, DialogTitle, Drawer, useMediaQuery, useTheme } from '@mui/material';
import { ErrorBoundary } from '../layout/ErrorBoundary';
import { EventForm, type EventFormProps } from './EventForm';

/**
 * Add/edit event sheet: a bottom drawer on phones, a dialog from the `md` breakpoint up.
 * Mount it only while open so the form always starts from fresh props (and from "now").
 */
export function EventSheet(props: EventFormProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const isDesktop = useMediaQuery(theme.breakpoints.up('md'));
  const title = props.event ? t('events.editTitle') : t('events.addTitle');
  const form = (
    <ErrorBoundary>
      <EventForm {...props} />
    </ErrorBoundary>
  );

  if (isDesktop) {
    return (
      <Dialog open onClose={props.onDone} fullWidth maxWidth="sm">
        <DialogTitle>{title}</DialogTitle>
        <DialogContent sx={{ pt: 1 }}>{form}</DialogContent>
      </Dialog>
    );
  }
  return (
    <Drawer
      anchor="bottom"
      open
      onClose={props.onDone}
      slotProps={{
        paper: { sx: { maxHeight: '92dvh', borderTopLeftRadius: 16, borderTopRightRadius: 16 } },
      }}
    >
      <DialogTitle component="h2">{title}</DialogTitle>
      <DialogContent sx={{ pt: 1 }}>{form}</DialogContent>
    </Drawer>
  );
}
