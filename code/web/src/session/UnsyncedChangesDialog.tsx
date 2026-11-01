import { useTranslation } from 'react-i18next';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
} from '@mui/material';

interface Props {
  title: string;
  message: string;
  pushLabel: string;
  proceedLabel: string;
  pending?: boolean;
  error?: string | null;
  onPush: () => void;
  onProceed: () => void;
  onCancel: () => void;
}

/** Mount while open. Warns before an action that discards unsynced changes; offers to push first. */
export function UnsyncedChangesDialog({
  title,
  message,
  pushLabel,
  proceedLabel,
  pending = false,
  error = null,
  onPush,
  onProceed,
  onCancel,
}: Props) {
  const { t } = useTranslation();
  return (
    <Dialog open onClose={onCancel}>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <DialogContentText>{message}</DialogContentText>
        {error && (
          <Alert severity="warning" sx={{ mt: 2 }}>
            {error}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel}>{t('common.cancel')}</Button>
        <Button onClick={onPush} disabled={pending}>
          {pushLabel}
        </Button>
        <Button color="error" onClick={onProceed} disabled={pending}>
          {proceedLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
