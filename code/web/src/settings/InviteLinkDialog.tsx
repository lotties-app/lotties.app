import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Stack,
  TextField,
} from '@mui/material';
import { inviteLink } from './inviteLink';
import { Icon } from '../ui/Icon';

interface Props {
  token: string;
  onClose: () => void;
}

/**
 * Shows a freshly created invite link. The token only exists in this dialog's props: once closed
 * the link cannot be shown again (the server keeps only its hash).
 */
export function InviteLinkDialog({ token, onClose }: Props) {
  const { t } = useTranslation();
  const link = inviteLink(token);
  const [copied, setCopied] = useState<'yes' | 'failed' | null>(null);
  const canShare = typeof navigator.share === 'function';

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied('yes');
    } catch {
      setCopied('failed');
    }
  };

  const share = async () => {
    try {
      await navigator.share({ title: t('settings.invites.shareTitle'), url: link });
    } catch {
      // The user dismissed the share sheet.
    }
  };

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{t('settings.invites.linkTitle')}</DialogTitle>
      <DialogContent>
        <Stack spacing={2}>
          <DialogContentText>{t('settings.invites.linkWarning')}</DialogContentText>
          <TextField
            label={t('settings.invites.linkTitle')}
            value={link}
            slotProps={{ input: { readOnly: true } }}
            onFocus={(e) => e.target.select()}
          />
          {copied === 'yes' && <Alert severity="success">{t('settings.invites.linkCopied')}</Alert>}
          {copied === 'failed' && (
            <Alert severity="warning">{t('settings.invites.copyFailed')}</Alert>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        {canShare && (
          <Button startIcon={<Icon name="share" />} onClick={() => void share()}>
            {t('settings.invites.share')}
          </Button>
        )}
        <Button startIcon={<Icon name="copy" />} onClick={() => void copy()}>
          {t('settings.invites.copy')}
        </Button>
        <Button variant="contained" onClick={onClose}>
          {t('common.done')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
