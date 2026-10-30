import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Snackbar } from '@mui/material';
import { describeApiError } from '../api/errorMessages';
import { useDatabase } from '../db/DatabaseContext';
import { restoreDeletedEvent } from '../now/nightEndsWakeUp';
import { TOAST_BOTTOM } from '../now/ui/ToastHost';
import { dismissDeletedNotice, useDeletedNotice } from './deletedEvents';

const UNDO_MS = 6_000;

/**
 * "Bottle deleted · Undo" after an event is deleted (docs/design/SYNTHESIS.md: undo replaces the
 * delete confirmation). Undo writes the event again with a new id (the server keeps the deleted
 * copy, so a fresh id is the only way back that every device accepts), together with a night's
 * automatic wake-up deleted with it. Mount once in the shell.
 */
export function DeletedEventSnackbar() {
  const { t } = useTranslation();
  const db = useDatabase();
  const notice = useDeletedNotice();
  const [error, setError] = useState<string | null>(null);

  const undo = async () => {
    if (!notice) return;
    const { event, wakeUp, id } = notice;
    dismissDeletedNotice(id);
    try {
      await restoreDeletedEvent(db, event, wakeUp);
    } catch (e) {
      setError(describeApiError(e));
    }
  };

  return (
    <>
      <Snackbar
        key={notice?.id ?? 'none'}
        open={notice !== null}
        autoHideDuration={UNDO_MS}
        onClose={(_, reason) => reason !== 'clickaway' && dismissDeletedNotice(notice?.id)}
        message={notice ? t('events.deleted', { name: notice.name }) : ''}
        sx={{ bottom: TOAST_BOTTOM }}
        action={
          <Button color="inherit" size="small" onClick={() => void undo()} sx={{ minHeight: 40 }}>
            {t('presets.undo.action')}
          </Button>
        }
      />
      <Snackbar
        open={error !== null}
        autoHideDuration={UNDO_MS}
        onClose={() => setError(null)}
        message={error}
        sx={{ bottom: TOAST_BOTTOM }}
      />
    </>
  );
}
