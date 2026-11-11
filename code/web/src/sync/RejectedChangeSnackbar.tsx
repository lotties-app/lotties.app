import { useTranslation } from 'react-i18next';
import { AppSnackbar } from '../ui/AppSnackbar';
import { dismissRejectionNotice, useRejectionNotice } from './rejectionNotice';

const NOTICE_MS = 8_000;

const MESSAGES = {
  notOwned: 'sync.rejectedNotOwned',
  role: 'sync.rejectedRole',
  proposalDecided: 'sync.rejectedProposalDecided',
} as const;

/**
 * Says once, without blocking, that the server refused a change because of the user's role (see
 * `rejectionNotice.ts`). Mount once in the shell.
 */
export function RejectedChangeSnackbar() {
  const { t } = useTranslation();
  const notice = useRejectionNotice();
  return (
    <AppSnackbar
      key={notice?.id ?? 'none'}
      open={notice !== null}
      autoHideDuration={NOTICE_MS}
      onClose={(_, reason) => reason !== 'clickaway' && dismissRejectionNotice(notice?.id)}
      message={notice ? t(MESSAGES[notice.kind]) : ''}
    />
  );
}
