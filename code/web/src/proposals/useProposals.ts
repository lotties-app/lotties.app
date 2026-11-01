import { useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { canDecideProposals } from '../baby/permissions';
import { useDatabase } from '../db/DatabaseContext';
import {
  acceptProposal,
  createProposal,
  declineProposal,
  markNoteRead,
  updateProposal,
  withdrawProposal,
} from '../db/proposalCommands';
import type { Baby } from '../db/models';
import { useNotes } from '../notes/useNotes';
import {
  inboxCount,
  recommendationsFor,
  unreadRecommendations,
  type ProposalTerms,
} from './proposalModel';

/** The baby's proposals on this device, every status (`undefined` while loading). */
export function useProposals(babyId: string) {
  const db = useDatabase();
  return useLiveQuery(() => db.proposals.where('babyId').equals(babyId).toArray(), [db, babyId]);
}

/** One proposal; `null` when it is not on this device (`undefined` while loading). */
export function useProposal(id: string | null) {
  const db = useDatabase();
  return useLiveQuery(async () => (id ? ((await db.proposals.get(id)) ?? null) : null), [db, id]);
}

/** The notes this user opened (first reads), `undefined` while loading. */
export function useNoteReads(babyId: string) {
  const db = useDatabase();
  return useLiveQuery(() => db.noteReads.where('babyId').equals(babyId).toArray(), [db, babyId]);
}

/** Proposal commands bound to the account's database (offline first: saved, then queued for sync). */
export function useProposalCommands() {
  const db = useDatabase();
  return {
    create: (babyId: string, authorUserId: string | null, terms: ProposalTerms) =>
      createProposal(db, babyId, authorUserId, terms),
    update: (id: string, terms: ProposalTerms) => updateProposal(db, id, terms),
    withdraw: (id: string) => withdrawProposal(db, id),
    accept: (id: string) => acceptProposal(db, id),
    decline: (id: string, reason: string | null) => declineProposal(db, id, reason),
    markRead: (babyId: string, noteId: string) => markNoteRead(db, babyId, noteId),
  };
}

/**
 * What the family got from the doctor: the shared recommendations (all and unread) and the number
 * on the "From your doctor" entry. `undefined` while the local data loads.
 */
export function useDoctorInbox(baby: Pick<Baby, 'id' | 'userId'>) {
  const notes = useNotes(baby.id);
  const reads = useNoteReads(baby.id);
  const proposals = useProposals(baby.id);
  if (!notes || !reads || !proposals) return undefined;
  const unread = unreadRecommendations(notes, reads, baby);
  return {
    proposals,
    recommendations: recommendationsFor(notes, baby),
    unread,
    count: inboxCount(proposals, unread),
  };
}

/** The unread recommendations of the baby (`undefined` while loading). */
export function useUnreadRecommendations(baby: Pick<Baby, 'id' | 'userId'>) {
  const notes = useNotes(baby.id);
  const reads = useNoteReads(baby.id);
  if (!notes || !reads) return undefined;
  return unreadRecommendations(notes, reads, baby);
}

/**
 * The Owners and Parents who open the notes read every recommendation in full there: mark the unread
 * ones read (queued like any read), so they leave the inbox and the Settings badge.
 */
export function useReadRecommendationsOnView(baby: Pick<Baby, 'id' | 'userId' | 'role'>) {
  const db = useDatabase();
  const unread = useUnreadRecommendations(baby);
  const ids = (unread ?? []).map((note) => note.id).join(',');
  const decides = canDecideProposals(baby);
  useEffect(() => {
    if (!decides || ids === '') return;
    for (const id of ids.split(',')) void markNoteRead(db, baby.id, id);
  }, [db, baby.id, decides, ids]);
}
