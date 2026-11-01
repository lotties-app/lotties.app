import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink } from 'react-router-dom';
import { Box, Button, Card, Stack, Typography } from '@mui/material';
import { canDecideProposals } from '../baby/permissions';
import type { Baby, Note, PersonSummary, Proposal } from '../db/models';
import { summaryText } from '../medications/prescriptionForm';
import { doctorLabel } from '../professional/doctorLabel';
import { SelfDeclaredBadge } from '../professional/DoctorName';
import { CategoryIcon } from '../ui/CategoryIcon';
import { ProposalDetailsSheet } from './ProposalDetailsSheet';
import { INBOX_LIMIT, contentOf, firstLine, inboxItems, type InboxItem } from './proposalModel';
import { RecommendationSheet } from './RecommendationSheet';
import { useDoctorInbox } from './useProposals';

/** "Dr. Ana Souza", or "Your doctor" when the author is not known on this device yet. */
function useDoctorTitle() {
  const { t } = useTranslation();
  return (person: PersonSummary | null) =>
    person ? doctorLabel(t, person) : t('proposals.unknownDoctor');
}

function InboxCard({
  icon,
  title,
  person,
  action,
  children,
}: {
  icon: 'pill' | 'note';
  title: string;
  person: PersonSummary | null;
  action: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card component="section" aria-label={title} sx={{ p: 2.5 }}>
      <Stack spacing={1.5}>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5 }}>
          <CategoryIcon name={icon} category="health" size={20} />
          <Stack spacing={0.5} sx={{ flex: 1, minWidth: 0 }}>
            <Typography sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{title}</Typography>
            {person && (
              <Box>
                <SelfDeclaredBadge verified={person.professional?.verified === true} />
              </Box>
            )}
            {children}
          </Stack>
        </Box>
        <Stack direction="row" sx={{ justifyContent: 'flex-end' }}>
          {action}
        </Stack>
      </Stack>
    </Card>
  );
}

function ProposalInboxCard({ proposal, onReview }: { proposal: Proposal; onReview: () => void }) {
  const { t } = useTranslation();
  const doctor = useDoctorTitle();
  const summary = summaryText(contentOf(proposal));
  const title = t('proposals.inbox.proposalTitle', { doctor: doctor(proposal.author) });
  return (
    <InboxCard
      icon="pill"
      title={title}
      person={proposal.author}
      action={
        <Button
          variant="contained"
          onClick={onReview}
          aria-label={t('proposals.inbox.reviewNamed', { name: proposal.medicationName })}
          sx={{ minHeight: 48 }}
        >
          {t('proposals.inbox.review')}
        </Button>
      }
    >
      <Typography sx={{ overflowWrap: 'anywhere' }}>{proposal.medicationName}</Typography>
      {summary && (
        <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
          {summary}
        </Typography>
      )}
    </InboxCard>
  );
}

function RecommendationInboxCard({ note, onRead }: { note: Note; onRead: () => void }) {
  const { t } = useTranslation();
  const doctor = useDoctorTitle();
  const name = doctor(note.author);
  return (
    <InboxCard
      icon="note"
      title={t('proposals.inbox.recommendationTitle', { doctor: name })}
      person={note.author}
      action={
        <Button
          variant="contained"
          onClick={onRead}
          aria-label={t('proposals.inbox.readNamed', { doctor: name })}
          sx={{ minHeight: 48 }}
        >
          {t('proposals.inbox.read')}
        </Button>
      }
    >
      <Typography
        sx={{
          overflowWrap: 'anywhere',
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}
      >
        {firstLine(note.body)}
      </Typography>
    </InboxCard>
  );
}

type Open = { kind: 'proposal'; id: string } | { kind: 'recommendation'; note: Note } | null;

function InboxCards({ baby }: { baby: Baby }) {
  const { t } = useTranslation();
  const inbox = useDoctorInbox(baby);
  const [open, setOpen] = useState<Open>(null);
  if (!inbox) return null;
  const items = inboxItems(inbox.proposals, inbox.unread);
  if (items.length === 0 && open === null) return null;
  const shown: InboxItem[] = items.slice(0, INBOX_LIMIT);

  return (
    <Stack component="section" spacing={2} aria-label={t('proposals.inbox.region')}>
      {shown.map((item) =>
        item.kind === 'proposal' ? (
          <ProposalInboxCard
            key={`p-${item.proposal.id}`}
            proposal={item.proposal}
            onReview={() => setOpen({ kind: 'proposal', id: item.proposal.id })}
          />
        ) : (
          <RecommendationInboxCard
            key={`r-${item.note.id}`}
            note={item.note}
            onRead={() => setOpen({ kind: 'recommendation', note: item.note })}
          />
        ),
      )}
      {items.length > INBOX_LIMIT && (
        <Button
          component={RouterLink}
          to="/from-doctor"
          sx={{ minHeight: 48, alignSelf: 'flex-start' }}
        >
          {t('proposals.inbox.seeAll')}
        </Button>
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

/**
 * The doctor's suggestions on Now, for the Owners and Parents (docs/design/16-doctor-access.md
 * section 10.3): a card per proposal waiting for a decision and per unread recommendation, newest
 * first, at most three, then "See all from your doctor". Nothing for anyone else.
 */
export function DoctorInbox({ baby }: { baby: Baby }) {
  if (!canDecideProposals(baby)) return null;
  return <InboxCards baby={baby} />;
}
