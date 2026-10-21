import { useTranslation } from 'react-i18next';
import { Alert, AlertTitle, Button } from '@mui/material';

export type NoticeKind = 'failed' | 'ended';

interface Props {
  kind: NoticeKind;
  /** Changes waiting to sync on this device after the session ended (`null` = unknown). */
  unsynced: number | null;
  onSignIn: () => void;
}

/**
 * Why the visitor is on the page although a sign-in was expected: the redirect or the sign-in
 * failed (retry), or the session ended and the changes kept on this device wait for a new sign-in.
 */
export function SessionNotice({ kind, unsynced, onSignIn }: Props) {
  const { t } = useTranslation('landing');
  const failed = kind === 'failed';
  const action = (
    <Button color="inherit" size="small" onClick={onSignIn} sx={{ minHeight: 44 }}>
      {failed ? t('notice.retry') : t('notice.signIn')}
    </Button>
  );
  return (
    <Alert
      severity={failed ? 'error' : 'info'}
      role={failed ? 'alert' : 'status'}
      action={action}
      sx={{ alignItems: 'center', textAlign: 'start' }}
    >
      <AlertTitle>{failed ? t('notice.failedTitle') : t('notice.endedTitle')}</AlertTitle>
      {failed
        ? t('notice.failedBody')
        : unsynced
          ? t('notice.ended', { count: unsynced })
          : t('notice.endedUnknown')}
    </Alert>
  );
}
