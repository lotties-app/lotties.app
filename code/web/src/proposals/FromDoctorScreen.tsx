import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Box, ButtonBase, Chip, Paper, Skeleton, Stack, Typography } from '@mui/material';
import { canDecideProposals } from '../baby/permissions';
import type { Baby, Note, Proposal } from '../db/models';
import { formatDate, formatDateTime } from '../i18n/format';
import { summaryText } from '../medications/prescriptionForm';
import { DoctorName } from '../professional/DoctorName';
import { useNotificationLink } from '../notifications/notificationLinkContext';
import { RADIUS } from '../theme/tokens';
import { CategoryIcon } from '../ui/CategoryIcon';
import { Icon } from '../ui/Icon';
import { ProposalDetailsSheet } from './ProposalDetailsSheet';
import { contentOf, decidedProposals, waitingProposals } from './proposalModel';
import { ProposalStatusChips } from './ProposalStatusChip';
import { RecommendationSheet } from './RecommendationSheet';
import { useDoctorInbox } from './useProposals';

/** A tappable card of the page: an icon, the lines, and a chevron. */
function Row({
  label,
  onOpen,
  icon,
  children,
}: {
  label: string;
  onOpen: () => void;
  icon: 'pill' | 'star';
  children: ReactNode;
}) {
  return (
    <Paper
      component="li"
      sx={{ borderRadius: `${RADIUS.card}px`, listStyle: 'none', overflow: 'hidden' }}
    >
      <ButtonBase
        onClick={onOpen}
        aria-label={label}
        sx={{
          width: '100%',
          p: 2,
          display: 'flex',
          gap: 1.5,
          alignItems: 'flex-start',
          justifyContent: 'flex-start',
          textAlign: 'start',
        }}
      >
        <CategoryIcon name={icon} category="health" size={20} />
        <Stack spacing={0.75} sx={{ flex: 1, minWidth: 0 }}>
          {children}
        </Stack>
        <Icon name="chevron-right" sx={{ mt: 0.5 }} />
      </ButtonBase>
    </Paper>
  );
}

function ProposalRow({ proposal, onOpen }: { proposal: Proposal; onOpen: () => void }) {
  const { t } = useTranslation();
  const summary = summaryText(contentOf(proposal));
  const open = proposal.status === 'pending' && proposal.decisionPending !== true;
  return (
    <Row
      icon="pill"
      label={t('proposals.fromDoctor.openProposal', { name: proposal.medicationName })}
      onOpen={onOpen}
    >
      <Typography sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>
        {proposal.medicationName}
      </Typography>
      {summary && (
        <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
          {summary}
        </Typography>
      )}
      {proposal.author && <DoctorName person={proposal.author} variant="body2" />}
      <Typography variant="caption" color="text.secondary">
        {t('proposals.sent', { date: formatDate(proposal.createdAt, 'dayMonthYear') })}
      </Typography>
      {!open && <ProposalStatusChips proposal={proposal} />}
      {proposal.status === 'declined' && proposal.declineReason && (
        <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>
          {t('proposals.reason', { reason: proposal.declineReason })}
        </Typography>
      )}
    </Row>
  );
}

function RecommendationRow({
  note,
  unread,
  onOpen,
}: {
  note: Note;
  unread: boolean;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Row
      icon="star"
      label={t('proposals.fromDoctor.openRecommendation', { date: formatDateTime(note.createdAt) })}
      onOpen={onOpen}
    >
      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
        {note.author && <DoctorName person={note.author} variant="body2" />}
        {unread && (
          <Chip
            size="small"
            color="primary"
            label={t('proposals.fromDoctor.unread')}
            sx={{ height: 22, fontSize: '0.75rem' }}
          />
        )}
      </Box>
      <Typography
        sx={{
          overflowWrap: 'anywhere',
          whiteSpace: 'pre-wrap',
          display: '-webkit-box',
          WebkitLineClamp: 3,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
          fontWeight: unread ? 600 : 400,
        }}
      >
        {note.body}
      </Typography>
      <Typography variant="caption" color="text.secondary">
        {formatDateTime(note.createdAt)}
      </Typography>
    </Row>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <Stack component="section" aria-labelledby={id} spacing={1.25}>
      <Typography id={id} variant="h6" component="h2">
        {title}
      </Typography>
      {children}
    </Stack>
  );
}

type Open = { kind: 'proposal'; id: string } | { kind: 'recommendation'; note: Note } | null;

/**
 * "From your doctor" (route `/from-doctor`, docs/design/16-doctor-access.md section 10.3): the
 * suggestions waiting for the parents, the recommendations (unread first, marked until opened) and
 * what was decided. Only the Owners and Parents decide; everyone else is told it is theirs to see.
 */
export function FromDoctorScreen({ baby }: { baby: Baby }) {
  const { t } = useTranslation();
  const inbox = useDoctorInbox(baby);
  const [open, setOpen] = useState<Open>(null);
  const links = useNotificationLink();
  const link = links?.link;
  // A doctor-suggestion notification lands here: the page is what it opens, nothing else to do.
  useEffect(() => {
    if (link?.kind === 'doctor' && link.babyId === baby.id) links?.consume();
  }, [link, links, baby.id]);

  const header = (
    <Stack>
      <Typography variant="h4" component="h1">
        {t('proposals.fromDoctor.title')}
      </Typography>
      <Typography color="text.secondary">
        {t('proposals.fromDoctor.subtitle', { name: baby.name })}
      </Typography>
    </Stack>
  );
  if (!canDecideProposals(baby)) {
    return (
      <Stack spacing={2.5}>
        {header}
        <Alert severity="info">{t('proposals.fromDoctor.parentsOnly')}</Alert>
      </Stack>
    );
  }
  if (!inbox) {
    return (
      <Stack spacing={2.5} role="status" aria-busy="true" aria-label={t('common.loading')}>
        {header}
        <Skeleton variant="rounded" height={110} />
        <Skeleton variant="rounded" height={110} />
      </Stack>
    );
  }

  const waiting = waitingProposals(inbox.proposals);
  const decided = decidedProposals(inbox.proposals);
  const unread = new Set(inbox.unread.map((note) => note.id));
  // Unread first, each group newest first (the model already sorts newest first).
  const recommendations = [
    ...inbox.recommendations.filter((note) => unread.has(note.id)),
    ...inbox.recommendations.filter((note) => !unread.has(note.id)),
  ];
  const empty = waiting.length + decided.length + recommendations.length === 0;

  return (
    <Stack spacing={2.5}>
      {header}
      {empty ? (
        <Box sx={{ display: 'grid', justifyItems: 'center', gap: 1.5, py: 4, textAlign: 'center' }}>
          <CategoryIcon name="stethoscope" category="health" size={32} />
          <Typography variant="h6" component="h2">
            {t('proposals.fromDoctor.emptyTitle')}
          </Typography>
          <Typography color="text.secondary">
            {t('proposals.fromDoctor.emptyBody', { name: baby.name })}
          </Typography>
        </Box>
      ) : (
        <>
          <Section id="from-doctor-waiting" title={t('proposals.fromDoctor.waiting')}>
            {waiting.length === 0 ? (
              <Typography color="text.secondary">
                {t('proposals.fromDoctor.nothingWaiting')}
              </Typography>
            ) : (
              <Stack component="ul" spacing={1.5} sx={{ p: 0, m: 0 }}>
                {waiting.map((proposal) => (
                  <ProposalRow
                    key={proposal.id}
                    proposal={proposal}
                    onOpen={() => setOpen({ kind: 'proposal', id: proposal.id })}
                  />
                ))}
              </Stack>
            )}
          </Section>
          {recommendations.length > 0 && (
            <Section
              id="from-doctor-recommendations"
              title={t('proposals.fromDoctor.recommendations')}
            >
              <Stack component="ul" spacing={1.5} sx={{ p: 0, m: 0 }}>
                {recommendations.map((note) => (
                  <RecommendationRow
                    key={note.id}
                    note={note}
                    unread={unread.has(note.id)}
                    onOpen={() => setOpen({ kind: 'recommendation', note })}
                  />
                ))}
              </Stack>
            </Section>
          )}
          {decided.length > 0 && (
            <Section id="from-doctor-decided" title={t('proposals.fromDoctor.decided')}>
              <Stack component="ul" spacing={1.5} sx={{ p: 0, m: 0 }}>
                {decided.map((proposal) => (
                  <ProposalRow
                    key={proposal.id}
                    proposal={proposal}
                    onOpen={() => setOpen({ kind: 'proposal', id: proposal.id })}
                  />
                ))}
              </Stack>
            </Section>
          )}
        </>
      )}
      {open?.kind === 'proposal' && (
        <ProposalDetailsSheet baby={baby} proposalId={open.id} onClose={() => setOpen(null)} />
      )}
      {open?.kind === 'recommendation' && (
        <RecommendationSheet baby={baby} note={open.note} onClose={() => setOpen(null)} />
      )}
    </Stack>
  );
}
