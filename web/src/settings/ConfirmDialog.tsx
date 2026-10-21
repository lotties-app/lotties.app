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
  body: string;
  confirmLabel: string;
  cancelLabel?: string;
  pending?: boolean;
  error?: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}

/** Mount while open. Destructive confirmation used across settings. */
export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  cancelLabel = 'Cancel',
  pending = false,
  error = null,
  onCancel,
  onConfirm,
}: Props) {
  return (
    <Dialog open onClose={onCancel}>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <DialogContentText>{body}</DialogContentText>
        {error && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {error}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel}>{cancelLabel}</Button>
        <Button color="error" onClick={onConfirm} disabled={pending}>
          {confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
