import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Button, Typography } from '@mui/material';
import { canDecideProposals } from '../baby/permissions';
import { usePrescriptions } from '../db/hooks';
import type { Baby, Proposal } from '../db/models';
import { InvalidProposalError } from '../db/proposalCommands';
import { formatDate } from '../i18n/format';
import { t as translate } from '../i18n/i18n';
import { EditorBody, EditorFooter, EditorFrame, EditorHeader } from '../medications/EditorShell';
import { GuardrailNote } from '../medications/GuardrailNote';
import { LinkedProduct } from '../medications/LinkedProduct';
import { summaryText } from '../medications/prescriptionForm';
import { DoctorName } from '../professional/DoctorName';
import { CategoryIcon } from '../ui/CategoryIcon';
import { Field, NotesRow } from '../ui/form';
import { Icon } from '../ui/Icon';
import { ContentFacts } from './ContentFacts';
import { DECLINE_REASON_MAX, contentOf, isOpen } from './proposalModel';
import { ProposalStatusChips } from './ProposalStatusChip';
import { useProposal, useProposalCommands } from './useProposals';

type Phase = 'view' | 'declining' | 'added';

/** What happened to a decided proposal, in a sentence (the decline reason is shown apart). */
function outcomeLine(proposal: Proposal): string | null {
  const when = formatDate(proposal.decidedAt ?? proposal.updatedAt, 'dayMonthYear');
  switch (proposal.status) {
    case 'accepted':
      return translate('proposals.details.acceptedOn', { date: when });
    case 'declined':
      return translate('proposals.details.declinedOn', { date: when });
    case 'superseded':
      return translate('proposals.details.superseded');
    case 'cancelled':
      return translate(
        proposal.cancelReason === 'access_removed'
          ? 'proposals.details.cancelledAccess'
          : 'proposals.details.cancelledWithdrawn',
      );
    case 'pending':
      return null;
  }
}

/**
 * One doctor's prescription suggestion (docs/design/16-doctor-access.md section 10): the medicine,
 * who suggested it, what it says in plain words, the course and the doctor's instructions, and what
 * accepting does. The Owners and Parents accept it (it is added to the baby's medicines) or decline
 * it with an optional reason the doctor sees. Anyone else, and a proposal already decided, reads it
 * with its status.
 */
export function ProposalDetailsSheet({
  baby,
  proposalId,
  onClose,
}: {
  baby: Baby;
  proposalId: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const titleId = useId();
  const proposal = useProposal(proposalId);
  const prescriptions = usePrescriptions(baby.id);
  const commands = useProposalCommands();
  const [phase, setPhase] = useState<Phase>('view');
  const [reason, setReason] = useState('');
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  if (proposal === undefined) return null;

  if (proposal === null) {
    return (
      <EditorFrame titleId={titleId} onClose={onClose}>
        <EditorHeader titleId={titleId} title={t('proposals.inbox.region')} onClose={onClose} />
        <EditorBody>
          <Typography color="text.secondary">{t('proposals.details.missing')}</Typography>
        </EditorBody>
      </EditorFrame>
    );
  }

  const decides = canDecideProposals(baby) && isOpen(proposal);
  const replaced = proposal.replacesPrescriptionId
    ? prescriptions?.find((p) => p.id === proposal.replacesPrescriptionId)
    : undefined;
  const outcome = outcomeLine(proposal);

  const run = async (action: () => Promise<unknown>, next: Phase | null) => {
    setSaving(true);
    setFailure(null);
    try {
      await action();
      if (next) setPhase(next);
      else onClose();
    } catch (error) {
      setFailure(
        error instanceof InvalidProposalError && error.code === 'decided'
          ? t('proposals.details.alreadyDecided')
          : t('proposals.details.decisionFailed'),
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <EditorFrame titleId={titleId} onClose={onClose}>
      <EditorHeader
        titleId={titleId}
        title={proposal.medicationName}
        onClose={onClose}
        leading={<CategoryIcon name="pill" category="health" size={24} />}
      />
      {phase === 'added' ? (
        <Added proposal={proposal} baby={baby} onDone={onClose} />
      ) : (
        <>
          <EditorBody>
            <Box sx={{ display: 'grid', gap: 0.75 }}>
              <Typography variant="caption" color="text.secondary">
                {t('proposals.details.suggestedBy')}
              </Typography>
              {proposal.author ? (
                <DoctorName person={proposal.author} variant="subtitle1" />
              ) : (
                <Typography sx={{ fontWeight: 600 }}>{t('proposals.unknownDoctor')}</Typography>
              )}
              <Typography variant="body2" color="text.secondary">
                {t('proposals.sent', { date: formatDate(proposal.createdAt, 'dayMonthYear') })}
              </Typography>
              {!isOpen(proposal) && <ProposalStatusChips proposal={proposal} />}
            </Box>
            <ContentFacts content={contentOf(proposal)} />
            {proposal.productId && (
              <Box sx={{ fontSize: '0.8125rem', color: 'text.secondary' }}>
                <LinkedProduct medication={{ productId: proposal.productId }} />
              </Box>
            )}
            {replaced && (
              <Box sx={{ display: 'grid', gap: 0.5 }}>
                <Typography>
                  {t('proposals.details.replacesCurrent', {
                    summary: summaryText(contentOf(replaced)) ?? '',
                  })}
                </Typography>
                {decides && (
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {t('proposals.details.replacesEnds')}
                  </Typography>
                )}
              </Box>
            )}
            {outcome && <Typography color="text.secondary">{outcome}</Typography>}
            {proposal.status === 'declined' && proposal.declineReason && (
              <Typography sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                {t('proposals.reason', { reason: proposal.declineReason })}
              </Typography>
            )}
            {decides && (
              <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
                <Icon name="info" size={16} sx={{ mt: '3px', color: 'text.secondary' }} />
                <Typography variant="body2" color="text.secondary">
                  {t('proposals.details.acceptAdds', { name: baby.name })}
                </Typography>
              </Box>
            )}
          </EditorBody>
          <EditorFooter>
            <GuardrailNote />
            {phase === 'declining' && decides ? (
              <Box sx={{ display: 'grid', gap: 1.25 }}>
                <Field
                  label={t('proposals.details.reasonLabel')}
                  help={t('proposals.details.reasonHelp')}
                >
                  <NotesRow
                    value={reason}
                    onChange={setReason}
                    maxLength={DECLINE_REASON_MAX}
                    counterFrom={DECLINE_REASON_MAX - 100}
                    defaultOpened
                  />
                </Field>
                {failure && (
                  <Box role="alert" sx={{ color: 'error.main', fontSize: '0.875rem' }}>
                    {failure}
                  </Box>
                )}
                <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                  <Button
                    variant="outlined"
                    color="inherit"
                    disabled={saving}
                    onClick={() => setPhase('view')}
                    sx={{ flex: '1 1 120px', minHeight: 52, borderRadius: '999px' }}
                  >
                    {t('common.cancel')}
                  </Button>
                  <Button
                    variant="contained"
                    color="error"
                    disabled={saving}
                    onClick={() => void run(() => commands.decline(proposal.id, reason), null)}
                    sx={{ flex: '1 1 140px', minHeight: 52, borderRadius: '999px' }}
                  >
                    {t('proposals.details.decline')}
                  </Button>
                </Box>
              </Box>
            ) : decides ? (
              <Box sx={{ display: 'grid', gap: 1 }}>
                {failure && (
                  <Box role="alert" sx={{ color: 'error.main', fontSize: '0.875rem' }}>
                    {failure}
                  </Box>
                )}
                <Button
                  variant="contained"
                  disabled={saving}
                  onClick={() => void run(() => commands.accept(proposal.id), 'added')}
                  sx={{ minHeight: 56, borderRadius: '999px', fontSize: '1rem' }}
                >
                  {t('proposals.details.accept')}
                </Button>
                <Button
                  variant="outlined"
                  color="inherit"
                  disabled={saving}
                  onClick={() => setPhase('declining')}
                  sx={{ minHeight: 52, borderRadius: '999px' }}
                >
                  {t('proposals.details.decline')}
                </Button>
              </Box>
            ) : (
              <Button
                variant="outlined"
                color="inherit"
                onClick={onClose}
                sx={{ minHeight: 52, borderRadius: '999px' }}
              >
                {t('common.done')}
              </Button>
            )}
          </EditorFooter>
        </>
      )}
    </EditorFrame>
  );
}

/** The short confirmation after accepting: "Added to Lia's medicines". */
function Added({ proposal, baby, onDone }: { proposal: Proposal; baby: Baby; onDone: () => void }) {
  const { t } = useTranslation();
  return (
    <>
      <EditorBody>
        <Box
          role="status"
          sx={{ display: 'grid', justifyItems: 'center', gap: 1.5, py: 3, textAlign: 'center' }}
        >
          <CategoryIcon name="success" category="health" size={32} />
          <Typography variant="h6" component="p">
            {t('proposals.details.addedTitle', { name: baby.name })}
          </Typography>
          {proposal.decisionPending === true && (
            <Typography color="text.secondary">{t('proposals.details.addedPending')}</Typography>
          )}
        </Box>
      </EditorBody>
      <EditorFooter>
        <Button
          variant="contained"
          onClick={onDone}
          sx={{ minHeight: 56, borderRadius: '999px', fontSize: '1rem' }}
        >
          {t('common.done')}
        </Button>
      </EditorFooter>
    </>
  );
}
