import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@mui/material';
import { AppSnackbar } from './AppSnackbar';
import { describeApiError } from '../api/errorMessages';
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
      <AppSnackbar
        key={notice?.id ?? 'none'}
        open={notice !== null}
        autoHideDuration={UNDO_MS}
        onClose={(_, reason) => reason !== 'clickaway' && dismissUndoNotice(notice?.id)}
        message={notice?.message ?? ''}
        action={
          <Button color="inherit" size="small" onClick={() => void undo()} sx={{ minHeight: 40 }}>
            {t('presets.undo.action')}
          </Button>
        }
      />
      <AppSnackbar
        open={error !== null}
        autoHideDuration={UNDO_MS}
        onClose={() => setError(null)}
        message={error}
      />
    </>
  );
}
