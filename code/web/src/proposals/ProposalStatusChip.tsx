import { useTranslation } from 'react-i18next';
import { Box, Chip } from '@mui/material';
import type { Proposal, ProposalStatus } from '../db/models';
import { Icon } from '../ui/Icon';
import type { IconName } from '../ui/icons';

const ICONS: Record<ProposalStatus, IconName> = {
  pending: 'clock',
  accepted: 'check',
  declined: 'close',
  cancelled: 'minus',
  superseded: 'exchange',
};

const COLORS = {
  pending: 'warning',
  accepted: 'success',
  declined: 'error',
  cancelled: 'default',
  superseded: 'default',
} as const;

/**
 * The status of a proposal as a chip with an icon (never colour alone): Pending, Accepted,
 * Declined, Cancelled or Replaced. A decision made on this device that did not reach the server
 * yet adds "Waiting to sync".
 */
export function ProposalStatusChips({
  proposal,
}: {
  proposal: Pick<Proposal, 'status' | 'decisionPending'>;
}) {
  const { t } = useTranslation();
  return (
    <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
      <Chip
        size="small"
        variant="outlined"
        color={COLORS[proposal.status]}
        icon={<Icon name={ICONS[proposal.status]} size={16} />}
        label={t(`proposals.status.${proposal.status}`)}
      />
      {proposal.decisionPending === true && (
        <Chip
          size="small"
          variant="outlined"
          icon={<Icon name="cloud-waiting" size={16} />}
          label={t('proposals.waitingToSync')}
        />
      )}
    </Box>
  );
}
