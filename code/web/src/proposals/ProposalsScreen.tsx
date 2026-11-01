import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Box, Button, Paper, Skeleton, Stack, Typography } from '@mui/material';
import { canPropose } from '../baby/permissions';
import { useAllPrescriptions, useEntitySyncStates } from '../db/hooks';
import type { Baby, Prescription, Proposal } from '../db/models';
import { formatDate } from '../i18n/format';
import { PrescriptionSheet } from '../medications/PrescriptionSheet';
import { summaryText } from '../medications/prescriptionForm';
import { ConfirmDialog } from '../settings/ConfirmDialog';
import { RADIUS } from '../theme/tokens';
import { CategoryIcon } from '../ui/CategoryIcon';
import { Icon } from '../ui/Icon';
import { byNewest, contentOf } from './proposalModel';
import { ProposalStatusChips } from './ProposalStatusChip';
import { useProposalCommands, useProposals } from './useProposals';

type Editor =
  | { kind: 'new' }
  | { kind: 'edit'; proposal: Proposal }
  | { kind: 'change'; proposal: Proposal; prescription: Prescription | undefined };

function ProposalRow({
  proposal,
  waiting,
  changeable,
  onEdit,
  onWithdraw,
  onChange,
}: {
  proposal: Proposal;
  /** The proposal itself (or its withdrawal) is still on its way to the server. */
  waiting: boolean;
  /** An accepted proposal whose prescription can still be changed. */
  changeable: boolean;
  onEdit: () => void;
  onWithdraw: () => void;
  onChange: () => void;
}) {
  const { t } = useTranslation();
  const summary = summaryText(contentOf(proposal));
  const name = proposal.medicationName;
  const pending = proposal.status === 'pending';
  return (
    <Paper
      component="li"
      aria-label={name}
      sx={{ borderRadius: `${RADIUS.card}px`, p: 2, listStyle: 'none' }}
    >
      <Stack spacing={1}>
        <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-start' }}>
          <CategoryIcon name="pill" category="health" size={20} />
          <Stack spacing={0.5} sx={{ flex: 1, minWidth: 0 }}>
            <Typography sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{name}</Typography>
            {summary && (
              <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
                {summary}
              </Typography>
            )}
            <Typography variant="caption" color="text.secondary">
              {t('proposals.sent', { date: formatDate(proposal.createdAt, 'dayMonthYear') })}
            </Typography>
          </Stack>
        </Box>
        <ProposalStatusChips proposal={{ status: proposal.status, decisionPending: waiting }} />
        {proposal.status === 'declined' && proposal.declineReason && (
          <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>
            {t('proposals.reason', { reason: proposal.declineReason })}
          </Typography>
        )}
        {proposal.status === 'cancelled' && proposal.cancelReason === 'access_removed' && (
          <Typography variant="body2" color="text.secondary">
            {t('proposals.accessRemoved')}
          </Typography>
        )}
        {(pending || changeable) && (
          <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 0.5 }}>
            {pending && (
              <>
                <Button
                  size="small"
                  startIcon={<Icon name="edit" size={20} />}
                  onClick={onEdit}
                  aria-label={t('proposals.mine.editNamed', { name })}
                  sx={{ minHeight: 44 }}
                >
                  {t('proposals.mine.edit')}
                </Button>
                <Button
                  size="small"
                  color="error"
                  startIcon={<Icon name="delete" size={20} />}
                  onClick={onWithdraw}
                  aria-label={t('proposals.mine.withdrawNamed', { name })}
                  sx={{ minHeight: 44 }}
                >
                  {t('proposals.mine.withdraw')}
                </Button>
              </>
            )}
            {changeable && (
              <Button
                size="small"
                startIcon={<Icon name="exchange" size={20} />}
                onClick={onChange}
                aria-label={t('proposals.mine.proposeChangeNamed', { name })}
                sx={{ minHeight: 44 }}
              >
                {t('proposals.mine.proposeChange')}
              </Button>
            )}
          </Stack>
        )}
      </Stack>
    </Paper>
  );
}

/**
 * "My proposals" (route `/proposals`, docs/design/16-doctor-access.md section 10.5): what the
 * baby's Doctor suggested, newest first, with each status. She prescribes a new medicine, edits or
 * withdraws a pending proposal and proposes a change to an accepted one. Offline first: everything
 * is saved on the device and queued.
 */
export function ProposalsScreen({ baby }: { baby: Baby }) {
  const { t } = useTranslation();
  const proposals = useProposals(baby.id);
  const prescriptions = useAllPrescriptions(baby.id);
  const states = useEntitySyncStates(baby.id);
  const commands = useProposalCommands();
  const [editor, setEditor] = useState<Editor | null>(null);
  const [withdrawing, setWithdrawing] = useState<Proposal | null>(null);

  if (!canPropose(baby)) {
    return <Alert severity="info">{t('proposals.mine.onlyDoctor')}</Alert>;
  }
  const prescribe = (
    <Button
      variant="contained"
      startIcon={<Icon name="add" size={20} />}
      onClick={() => setEditor({ kind: 'new' })}
      sx={{ minHeight: 48, borderRadius: '999px' }}
    >
      {t('proposals.mine.prescribe')}
    </Button>
  );
  // The rows wait for the outbox as well: drawn before it is read, a proposal written offline
  // would show as if it had already reached the parents (no "Waiting to sync").
  const list = proposals && states ? byNewest(proposals) : null;

  /** The prescription an accepted proposal created, unless it is known to be deleted. */
  const createdBy = (proposal: Proposal) =>
    prescriptions?.find((p) => p.id === proposal.acceptedPrescriptionId);

  return (
    <Stack spacing={2.5}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        <Stack sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="h4" component="h1">
            {t('proposals.mine.title')}
          </Typography>
          <Typography color="text.secondary">
            {t('proposals.mine.subtitle', { name: baby.name })}
          </Typography>
        </Stack>
        {prescribe}
      </Box>
      {!list || !prescriptions ? (
        <Stack spacing={1.5} role="status" aria-busy="true" aria-label={t('common.loading')}>
          <Skeleton variant="rounded" height={110} />
          <Skeleton variant="rounded" height={110} />
        </Stack>
      ) : list.length === 0 ? (
        <Box sx={{ display: 'grid', justifyItems: 'center', gap: 1.5, py: 4, textAlign: 'center' }}>
          <CategoryIcon name="pill" category="health" size={32} />
          <Typography variant="h6" component="h2">
            {t('proposals.mine.emptyTitle')}
          </Typography>
          <Typography color="text.secondary">
            {t('proposals.mine.emptyBody', { name: baby.name })}
          </Typography>
        </Box>
      ) : (
        <Stack
          component="ul"
          spacing={1.5}
          sx={{ p: 0, m: 0 }}
          aria-label={t('proposals.mine.listLabel')}
        >
          {list.map((proposal) => {
            const created = createdBy(proposal);
            return (
              <ProposalRow
                key={proposal.id}
                proposal={proposal}
                waiting={states?.get(proposal.id) === 'pending'}
                changeable={
                  proposal.status === 'accepted' &&
                  !!proposal.acceptedPrescriptionId &&
                  created?.deletedAt == null
                }
                onEdit={() => setEditor({ kind: 'edit', proposal })}
                onWithdraw={() => setWithdrawing(proposal)}
                onChange={() => setEditor({ kind: 'change', proposal, prescription: created })}
              />
            );
          })}
        </Stack>
      )}
      {editor && (
        <PrescriptionSheet
          mode="proposal"
          babyId={baby.id}
          authorUserId={baby.userId ?? null}
          onDone={() => setEditor(null)}
          {...(editor.kind === 'edit' ? { proposal: editor.proposal } : {})}
          {...(editor.kind === 'change' && editor.prescription
            ? { replaces: editor.prescription }
            : {})}
          {...(editor.kind === 'change' && !editor.prescription
            ? { replacesProposal: editor.proposal }
            : {})}
        />
      )}
      {withdrawing && (
        <ConfirmDialog
          title={t('proposals.mine.withdrawTitle')}
          body={t('proposals.mine.withdrawBody')}
          confirmLabel={t('proposals.mine.withdrawConfirm')}
          onCancel={() => setWithdrawing(null)}
          onConfirm={() => {
            void commands.withdraw(withdrawing.id);
            setWithdrawing(null);
          }}
        />
      )}
    </Stack>
  );
}
