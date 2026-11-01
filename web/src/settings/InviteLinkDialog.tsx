import { useState } from 'react';
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
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import ShareIcon from '@mui/icons-material/Share';
import { inviteLink } from './inviteLink';

interface Props {
  token: string;
  onClose: () => void;
}

/**
 * Shows a freshly created invite link. The token only exists in this dialog's props: once closed
 * the link cannot be shown again (the server keeps only its hash).
 */
export function InviteLinkDialog({ token, onClose }: Props) {
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
      await navigator.share({ title: 'Baby Routine invite', url: link });
    } catch {
      // The user dismissed the share sheet.
    }
  };

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Invite link</DialogTitle>
      <DialogContent>
        <Stack spacing={2}>
          <DialogContentText>
            Copy this link now: it is shown only once. Anyone who opens it while signed in can join.
          </DialogContentText>
          <TextField
            label="Invite link"
            value={link}
            slotProps={{ input: { readOnly: true } }}
            onFocus={(e) => e.target.select()}
          />
          {copied === 'yes' && <Alert severity="success">Link copied.</Alert>}
          {copied === 'failed' && (
            <Alert severity="warning">
              Could not copy automatically. Select the link and copy it.
            </Alert>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        {canShare && (
          <Button startIcon={<ShareIcon />} onClick={() => void share()}>
            Share
          </Button>
        )}
        <Button startIcon={<ContentCopyIcon />} onClick={() => void copy()}>
          Copy link
        </Button>
        <Button variant="contained" onClick={onClose}>
          Done
        </Button>
      </DialogActions>
    </Dialog>
  );
}
