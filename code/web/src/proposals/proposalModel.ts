import type {
  Baby,
  Note,
  NoteRead,
  PersonSummary,
  Prescription,
  PrescriptionContent,
  Proposal,
  ProposalStatus,
} from '../db/models';

/*
 * Prescription proposals and the recommendations inbox (docs/design/16-doctor-access.md section
 * 10). Pure helpers over local data, no I/O: which proposals wait for the parents, what is unread,
 * what the Now inbox and the Settings badge count, and who prescribed what.
 */

/** The longest medication name the API accepts (characters after trimming). */
export const PROPOSAL_NAME_MAX = 100;
/** The longest reason a parent can give when declining. */
export const DECLINE_REASON_MAX = 500;
/** The Now inbox shows this many cards; the rest are behind "See all from your doctor". */
export const INBOX_LIMIT = 3;

/** What a doctor edits: the prescription content, the medication reference and what it replaces. */
export interface ProposalTerms extends PrescriptionContent {
  /** A medication of the baby's list, when picked. */
  medicationId: string | null;
  /** A shared catalog product, when picked. */
  productId: string | null;
  /** 1-100 characters: the picked medication's or product's name, or free text. */
  medicationName: string;
  replacesPrescriptionId: string | null;
}

const BLANK_CONTENT_KEYS = [
  'kind',
  'dose',
  'timesOfDay',
  'everyMinutes',
  'dayParts',
  'dayPartReminders',
  'minIntervalMinutes',
  'maxDosesPer24h',
  'indication',
  'intervalGroup',
  'startDate',
  'endDate',
  'instructions',
] as const;

/** The content part of anything that carries it (a proposal, a prescription, its original). */
export function contentOf(
  source: Omit<PrescriptionContent, 'dayParts' | 'dayPartReminders'> &
    Partial<Pick<PrescriptionContent, 'dayParts' | 'dayPartReminders'>>,
): PrescriptionContent {
  const picked = Object.fromEntries(
    BLANK_CONTENT_KEYS.map((key) => [key, source[key as keyof typeof source]]),
  ) as unknown as PrescriptionContent;
  return {
    ...picked,
    dayParts: source.dayParts ?? null,
    dayPartReminders: source.dayPartReminders ?? null,
  };
}

export function proposalTermsOf(p: Proposal): ProposalTerms {
  return {
    ...contentOf(p),
    medicationId: p.medicationId,
    productId: p.productId,
    medicationName: p.medicationName,
    replacesPrescriptionId: p.replacesPrescriptionId,
  };
}

/** Open for a decision: pending and not already decided on this device. */
export function isOpen(p: Pick<Proposal, 'status' | 'decisionPending'>): boolean {
  return p.status === 'pending' && p.decisionPending !== true;
}

/** Newest sent first. */
export function byNewest<T extends { createdAt: string; id: string }>(list: readonly T[]): T[] {
  return [...list].sort(
    (a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id),
  );
}

/** The proposals waiting for a decision, newest first. */
export function waitingProposals(list: readonly Proposal[]): Proposal[] {
  return byNewest(list.filter(isOpen));
}

/** The proposals that are decided (also on this device only), the latest decision first. */
export function decidedProposals(list: readonly Proposal[]): Proposal[] {
  return [...list.filter((p) => !isOpen(p))].sort(
    (a, b) =>
      (b.decidedAt ?? b.updatedAt).localeCompare(a.decidedAt ?? a.updatedAt) ||
      a.id.localeCompare(b.id),
  );
}

/** Status chips, in the order the doctor's list explains them. */
export const PROPOSAL_STATUSES: readonly ProposalStatus[] = [
  'pending',
  'accepted',
  'declined',
  'cancelled',
  'superseded',
];

export const isProposalStatus = (value: unknown): value is ProposalStatus =>
  typeof value === 'string' && (PROPOSAL_STATUSES as readonly string[]).includes(value);

/** The shared recommendations a doctor sent the family (shared notes of kind recommendation). */
export function recommendationsFor(notes: readonly Note[], baby: Pick<Baby, 'userId'>): Note[] {
  return notes
    .filter(
      (note) =>
        note.deletedAt === null &&
        note.kind === 'recommendation' &&
        note.visibility === 'shared' &&
        // The reader's own notes are not "from her doctor".
        note.authorUserId !== null &&
        note.authorUserId !== (baby.userId ?? null),
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
}

/** Recommendations the user did not open yet. */
export function unreadRecommendations(
  notes: readonly Note[],
  reads: readonly Pick<NoteRead, 'noteId'>[],
  baby: Pick<Baby, 'userId'>,
): Note[] {
  const read = new Set(reads.map((r) => r.noteId));
  return recommendationsFor(notes, baby).filter((note) => !read.has(note.id));
}

export type InboxItem =
  | { kind: 'proposal'; proposal: Proposal; at: string }
  | { kind: 'recommendation'; note: Note; at: string };

/** Waiting proposals and unread recommendations as one list, newest first. */
export function inboxItems(proposals: readonly Proposal[], unread: readonly Note[]): InboxItem[] {
  const items: InboxItem[] = [
    ...waitingProposals(proposals).map((proposal) => ({
      kind: 'proposal' as const,
      proposal,
      at: proposal.createdAt,
    })),
    ...unread.map((note) => ({ kind: 'recommendation' as const, note, at: note.createdAt })),
  ];
  return items.sort((a, b) => b.at.localeCompare(a.at));
}

/** The number on the "From your doctor" entry: proposals waiting plus unread recommendations. */
export function inboxCount(proposals: readonly Proposal[], unread: readonly Note[]): number {
  return waitingProposals(proposals).length + unread.length;
}

/** The first line of a text, for the inbox card ("Offer 120 ml every 3 hours."). */
export function firstLine(text: string): string {
  return (
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line !== '') ?? ''
  );
}

/** Whether a doctor suggested this prescription (it carries provenance). */
export function isDoctorSourced(
  p: Pick<Prescription, 'prescribedByUserId' | 'prescribedByName' | 'prescribedBy' | 'proposalId'>,
): boolean {
  return !!(p.prescribedBy || p.prescribedByName || p.prescribedByUserId || p.proposalId);
}

/**
 * The doctor of a prescription as a person for `DoctorName` and `doctorNameOf`: the server's
 * summary when it sent one, else just the name she had when the parents accepted.
 */
export function prescriberOf(
  p: Pick<Prescription, 'prescribedByUserId' | 'prescribedByName' | 'prescribedBy'>,
): PersonSummary | null {
  if (p.prescribedBy) return p.prescribedBy;
  if (!p.prescribedByName) return null;
  return {
    userId: p.prescribedByUserId ?? '',
    displayName: p.prescribedByName,
    professional: null,
  };
}
