import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation();
  return (
    <Dialog open={open} onClose={onCancel}>
      <DialogTitle>{t('events.deleteTitle')}</DialogTitle>
      <DialogContent>
        <DialogContentText>{t('events.deleteBody')}</DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel}>{t('events.keep')}</Button>
        <Button color="error" onClick={onConfirm}>
          {t('events.deleteConfirm')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
