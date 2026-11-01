import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
} from '@mui/material';

interface Props {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ConfirmDeleteDialog({ open, onCancel, onConfirm }: Props) {
  return (
    <Dialog open={open} onClose={onCancel}>
      <DialogTitle>Delete this event?</DialogTitle>
      <DialogContent>
        <DialogContentText>It will be removed from the timeline on all devices.</DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel}>Keep</Button>
        <Button color="error" onClick={onConfirm}>
          Delete event
        </Button>
      </DialogActions>
    </Dialog>
  );
}
