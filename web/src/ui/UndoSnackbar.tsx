import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Snackbar } from '@mui/material';
import { describeApiError } from '../api/errorMessages';
import { TOAST_BOTTOM } from '../now/ui/ToastHost';
import { dismissUndoNotice, useUndoNotice } from './undoNotice';

const UNDO_MS = 6_000;

/** The "deleted · Undo" notice of prescriptions and medications. Mount once in the shell. */
export function UndoSnackbar() {
  const { t } = useTranslation();
  const notice = useUndoNotice();
  const [error, setError] = useState<string | null>(null);

  const undo = async () => {
    if (!notice) return;
    const { id, undo: restore } = notice;
    dismissUndoNotice(id);
    try {
      await restore();
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
        onClose={(_, reason) => reason !== 'clickaway' && dismissUndoNotice(notice?.id)}
        message={notice?.message ?? ''}
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
