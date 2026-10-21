import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent, DialogTitle, Drawer, useMediaQuery, useTheme } from '@mui/material';
import { useEventTypeText } from '../i18n/eventTypeText';
import { ErrorBoundary } from '../layout/ErrorBoundary';
import { EventForm, type EventFormProps } from './EventForm';

function useSheetTitle(props: EventFormProps): string {
  const { t } = useTranslation();
  const names = useEventTypeText();
  if (props.finish) {
    const type = props.types.find((candidate) => candidate.id === props.event?.typeId);
    const name = type ? names.typeName(type) : t('common.event');
    return t('events.finishTitle', { name: name.toLocaleLowerCase() });
  }
  return props.event ? t('events.editTitle') : t('events.addTitle');
}

/**
 * Add/edit event sheet: a bottom drawer on phones, a dialog from the `md` breakpoint up. Both are
 * named by their title. Mount it only while open so the form always starts from fresh props (and
 * from "now"). With `finish` it is the short "Finish this ..." sheet.
 */
export function EventSheet(props: EventFormProps) {
  const theme = useTheme();
  const isDesktop = useMediaQuery(theme.breakpoints.up('md'));
  const titleId = useId();
  const title = useSheetTitle(props);
  const form = (
    <ErrorBoundary>
      <EventForm {...props} />
    </ErrorBoundary>
  );

  if (isDesktop) {
    return (
      <Dialog open onClose={props.onDone} fullWidth maxWidth="sm" aria-labelledby={titleId}>
        <DialogTitle id={titleId}>{title}</DialogTitle>
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
        paper: {
          'aria-labelledby': titleId,
          sx: { maxHeight: '92dvh', borderTopLeftRadius: 16, borderTopRightRadius: 16 },
        },
      }}
    >
      <DialogTitle id={titleId} component="h2">
        {title}
      </DialogTitle>
      <DialogContent sx={{ pt: 1 }}>{form}</DialogContent>
    </Drawer>
  );
}
