import { describe, expect, it } from 'vitest';
import { prescription } from '../medications/prescriptionFixtures';
import { ANA, proposal, recommendation } from './proposalKit';
import {
  INBOX_LIMIT,
  byNewest,
  contentOf,
  decidedProposals,
  firstLine,
  inboxCount,
  inboxItems,
  isDoctorSourced,
  isOpen,
  prescriberOf,
  proposalTermsOf,
  recommendationsFor,
  unreadRecommendations,
  waitingProposals,
} from './proposalModel';

/* Pure helpers of the proposals and the recommendations inbox (docs/design/16-doctor-access.md section 10). */

const PARENT = { userId: 'mom' };

describe('proposals', () => {
  it('are open only while pending and not decided on this device', () => {
    expect(isOpen(proposal('a'))).toBe(true);
    expect(isOpen(proposal('b', { status: 'accepted' }))).toBe(false);
    expect(isOpen(proposal('c', { status: 'declined', decisionPending: true }))).toBe(false);
    expect(isOpen({ status: 'pending', decisionPending: true })).toBe(false);
  });

  it('wait for a decision newest first, and decided ones follow the latest decision', () => {
    const list = [
      proposal('old', { createdAt: '2026-10-20T08:00:00.000Z' }),
      proposal('new', { createdAt: '2026-10-22T09:30:00.000Z' }),
      proposal('d1', { status: 'accepted', decidedAt: '2026-10-21T10:00:00.000Z' }),
      proposal('d2', { status: 'declined', decidedAt: '2026-10-22T10:00:00.000Z' }),
      proposal('c1', {
        status: 'cancelled',
        decidedAt: null,
        updatedAt: '2026-10-19T10:00:00.000Z',
      }),
    ];

    expect(waitingProposals(list).map((p) => p.id)).toEqual(['new', 'old']);
    expect(decidedProposals(list).map((p) => p.id)).toEqual(['d2', 'd1', 'c1']);
    expect(byNewest(list).map((p) => p.id)[0]).toBe('new');
  });

  it('carry the same content as a prescription', () => {
    const p = proposal('a', { medicationId: 'm1', productId: 'p1', replacesPrescriptionId: 'rx' });

    expect(proposalTermsOf(p)).toMatchObject({
      medicationId: 'm1',
      productId: 'p1',
      medicationName: 'Colidis',
      replacesPrescriptionId: 'rx',
      kind: 'asNeeded',
      dose: { amount: 8, unit: 'drops' },
      minIntervalMinutes: 360,
      dayParts: null,
    });
    expect(Object.keys(contentOf(p)).sort()).toEqual(
      [
        'dayPartReminders',
        'dayParts',
        'dose',
        'endDate',
        'everyMinutes',
        'indication',
        'instructions',
        'intervalGroup',
        'kind',
        'maxDosesPer24h',
        'minIntervalMinutes',
        'startDate',
        'timesOfDay',
      ].sort(),
    );
  });
});

describe('the recommendations inbox', () => {
  const notes = [
    recommendation('shared', { createdAt: '2026-10-22T08:00:00.000Z' }),
    recommendation('newer', { createdAt: '2026-10-22T09:00:00.000Z' }),
    recommendation('private', { visibility: 'private' }),
    recommendation('plain', { kind: 'note' }),
    recommendation('deleted', { deletedAt: '2026-10-22T10:00:00.000Z' }),
    recommendation('own', { authorUserId: 'mom' }),
    recommendation('unsynced', { authorUserId: null }),
  ];

  it('lists the shared recommendations of someone else, newest first', () => {
    expect(recommendationsFor(notes, PARENT).map((n) => n.id)).toEqual(['newer', 'shared']);
  });

  it('keeps the unread ones: those without a read of this user', () => {
    expect(unreadRecommendations(notes, [{ noteId: 'newer' }], PARENT).map((n) => n.id)).toEqual([
      'shared',
    ]);
    expect(unreadRecommendations(notes, [], PARENT)).toHaveLength(2);
  });

  it('merges proposals and unread recommendations newest first and counts them', () => {
    const proposals = [
      proposal('p-old', { createdAt: '2026-10-22T07:00:00.000Z' }),
      proposal('p-done', { status: 'accepted' }),
    ];
    const unread = [recommendation('r', { createdAt: '2026-10-22T07:30:00.000Z' })];

    const items = inboxItems(proposals, unread);

    expect(items.map((i) => (i.kind === 'proposal' ? i.proposal.id : i.note.id))).toEqual([
      'r',
      'p-old',
    ]);
    expect(inboxCount(proposals, unread)).toBe(2);
    expect(INBOX_LIMIT).toBe(3);
  });

  it('shows the first line of a text', () => {
    expect(firstLine('\n  Offer 120 ml.  \nSecond')).toBe('Offer 120 ml.');
    expect(firstLine('   ')).toBe('');
  });
});

describe('provenance', () => {
  const sourced = prescription({
    prescribedByUserId: 'doctor-1',
    prescribedByName: 'Ana Souza',
    prescribedBy: ANA,
    proposalId: 'p1',
  });

  it('is on a prescription a doctor suggested, in any of its fields', () => {
    expect(isDoctorSourced(sourced)).toBe(true);
    expect(isDoctorSourced(prescription({ proposalId: 'p1' }))).toBe(true);
    expect(isDoctorSourced(prescription({ prescribedByName: 'Ana' }))).toBe(true);
    expect(isDoctorSourced(prescription())).toBe(false);
    expect(isDoctorSourced(prescription({ prescribedByUserId: null, proposalId: null }))).toBe(
      false,
    );
  });

  it('names the doctor from the server summary, else from the snapshot of her name', () => {
    expect(prescriberOf(sourced)).toBe(ANA);
    expect(
      prescriberOf(prescription({ prescribedByUserId: 'doctor-1', prescribedByName: 'Ana Souza' })),
    ).toEqual({ userId: 'doctor-1', displayName: 'Ana Souza', professional: null });
    expect(prescriberOf(prescription())).toBeNull();
  });
});
