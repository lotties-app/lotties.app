import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BabyRoutineDb } from '../db/database';
import type { BabyRole } from '../db/models';
import { prescription } from '../medications/prescriptionFixtures';
import { BABY_ID, fakeApi, testDatabase } from '../test/fakeApi';
import { useTestLocale } from '../test/locale';
import { renderWithDb, settleSync } from '../test/renderApp';
import { THEME_STORAGE_KEY } from '../theme/themeStorage';
import { DoctorInbox } from './DoctorInbox';
import { ANA, VERIFIED_ANA, proposal, recommendation, seedFamily } from './proposalKit';
import { ProposalDetailsSheet } from './ProposalDetailsSheet';

/*
 * The parents' inbox on Now and the suggestion's details sheet (docs/design/16-doctor-access.md
 * sections 10.3 and 10.5): a card per waiting proposal and unread recommendation, Accept and
 * Decline for the Owners and Parents only, nothing for anyone else.
 */

let db: BabyRoutineDb;

beforeEach(() => {
  db = testDatabase();
  window.localStorage.clear();
});

afterEach(async () => {
  await settleSync();
  await db.delete();
});

async function renderInbox(role: BabyRole = 'Owner') {
  const baby = await seedFamily(db, role);
  return renderWithDb(db, <DoctorInbox baby={baby} />, { api: fakeApi().api });
}

const card = (name: string | RegExp) => screen.findByRole('region', { name });
const outbox = async () =>
  (await db.outbox.toArray()).map((m) => [m.entityType, m.kind, m.payload]);

describe('the inbox cards', () => {
  it('shows a card per waiting proposal and unread recommendation, newest first', async () => {
    await db.proposals.bulkPut([
      proposal('p-old', { createdAt: '2026-10-22T07:00:00.000Z', medicationName: 'Old one' }),
      proposal('p-new', { createdAt: '2026-10-22T10:00:00.000Z', medicationName: 'New one' }),
      proposal('p-done', { status: 'accepted', medicationName: 'Decided one' }),
    ]);
    await db.notes.bulkPut([
      recommendation('r1', {
        createdAt: '2026-10-22T11:00:00.000Z',
        body: 'Offer 120 ml.\nSecond line.',
      }),
      recommendation('r-read', { body: 'Already read' }),
      recommendation('r-note', { kind: 'note', body: 'Just a note' }),
    ]);
    await db.noteReads.put({
      noteId: 'r-read',
      babyId: BABY_ID,
      readAt: '2026-10-22T12:00:00.000Z',
    });
    await renderInbox();

    await card('Dr. Ana Souza sent a recommendation');
    const cards = screen.getAllByRole('region').map((region) => region.getAttribute('aria-label'));
    expect(cards).toEqual([
      'From your doctor',
      'Dr. Ana Souza sent a recommendation',
      'Dr. Ana Souza suggested a prescription',
      'Dr. Ana Souza suggested a prescription',
    ]);
    expect(screen.getByText('Offer 120 ml.')).toBeTruthy();
    expect(screen.queryByText(/Second line/)).toBeNull();
    expect(screen.getAllByText('New one').length).toBe(1);
    expect(screen.queryByText('Decided one')).toBeNull();
    expect(screen.queryByText('Already read')).toBeNull();
    expect(screen.queryByText('Just a note')).toBeNull();
    expect(screen.queryByRole('link', { name: 'See all from your doctor' })).toBeNull();
  });

  it('describes a proposal in plain words with the doctor name and the badge', async () => {
    await db.proposals.put(proposal('p1'));
    await renderInbox();

    const proposalCard = await card('Dr. Ana Souza suggested a prescription');
    expect(within(proposalCard).getByText('Colidis')).toBeTruthy();
    expect(
      within(proposalCard).getByText(
        'Give 8 drops, no more often than every 6 hours, at most 4 doses in 24 hours, when belly pain, until Nov 5, 2026',
      ),
    ).toBeTruthy();
    expect(within(proposalCard).getByText('Self-declared doctor')).toBeTruthy();
    expect(
      within(proposalCard).getByRole('button', { name: 'Review the suggestion for Colidis' }),
    ).toBeTruthy();
  });

  it('shows "Verified professional" when the profile is verified', async () => {
    await db.proposals.put(proposal('p1', { author: VERIFIED_ANA }));
    await renderInbox();

    const proposalCard = await card('Dr. Ana Souza suggested a prescription');
    expect(within(proposalCard).getByText('Verified professional')).toBeTruthy();
    expect(within(proposalCard).queryByText('Self-declared doctor')).toBeNull();
  });

  it('names "Your doctor" when the author is not on the device yet', async () => {
    await db.proposals.put(proposal('p1', { author: null }));
    await renderInbox();

    expect(await card('Your doctor suggested a prescription')).toBeTruthy();
  });

  it('shows at most three cards, then "See all from your doctor"', async () => {
    await db.proposals.bulkPut(
      [1, 2, 3, 4].map((n) =>
        proposal(`p${n}`, { createdAt: `2026-10-22T0${n}:00:00.000Z`, medicationName: `Med ${n}` }),
      ),
    );
    await renderInbox();

    await screen.findByText('Med 4');
    expect(screen.getAllByRole('button', { name: /^Review/ })).toHaveLength(3);
    expect(screen.queryByText('Med 1')).toBeNull();
    const link = screen.getByRole('link', { name: 'See all from your doctor' });
    expect(link.getAttribute('href')).toBe('/from-doctor');
  });

  it.each<BabyRole>(['Caregiver', 'Viewer', 'Doctor'])(
    'shows nothing to a %s, who never decides',
    async (role) => {
      await db.proposals.put(proposal('p1'));
      await db.notes.put(recommendation('r1'));
      await renderInbox(role);

      await waitFor(async () => expect(await db.proposals.count()).toBe(1));
      expect(screen.queryByRole('region')).toBeNull();
      expect(screen.queryByRole('button', { name: /Review|Read/ })).toBeNull();
    },
  );
});

describe('accepting', () => {
  it('opens the details with what accepting does, and nothing is active before it', async () => {
    await db.prescriptions.put(
      prescription({
        id: 'rx-current',
        babyId: BABY_ID,
        medicationId: 'm-z',
        minIntervalMinutes: 480,
        dose: { amount: 5, unit: 'drops', perKg: false, roundingStep: null },
        indication: 'belly pain',
      }),
    );
    await db.proposals.put(proposal('p1', { replacesPrescriptionId: 'rx-current' }));
    await renderInbox();

    fireEvent.click(
      await screen.findByRole('button', { name: 'Review the suggestion for Colidis' }),
    );

    const sheet = await screen.findByRole('dialog', { name: 'Colidis' });
    expect(within(sheet).getByText('Suggested by')).toBeTruthy();
    expect(within(sheet).getByText('Dr. Ana Souza')).toBeTruthy();
    expect(within(sheet).getByText('Self-declared doctor')).toBeTruthy();
    expect(within(sheet).getByText('From Oct 22, 2026 to Nov 5, 2026')).toBeTruthy();
    expect(within(sheet).getByText('Give it after the feed.')).toBeTruthy();
    expect(
      within(sheet).getByText(
        'Changes the current prescription: Give 5 drops, no more often than every 8 hours, when belly pain',
      ),
    ).toBeTruthy();
    expect(within(sheet).getByText('Accepting ends the current one today.')).toBeTruthy();
    expect(
      within(sheet).getByText(
        'Accepting adds this prescription to Lia. You can end it at any time.',
      ),
    ).toBeTruthy();
    expect(within(sheet).getByRole('note').textContent).toMatch(/not a medical device/);
    expect(await db.prescriptions.count()).toBe(1);
    expect(await db.outbox.count()).toBe(0);
  });

  it('shows no replacement lines when the proposal replaces nothing', async () => {
    await db.proposals.put(proposal('p1'));
    await renderInbox();

    fireEvent.click(await screen.findByRole('button', { name: /^Review/ }));

    const sheet = await screen.findByRole('dialog', { name: 'Colidis' });
    expect(within(sheet).queryByText(/Changes the current prescription/)).toBeNull();
    expect(within(sheet).queryByText(/Accepting ends the current one/)).toBeNull();
  });

  it('accepts: queues one decision, confirms, and the card leaves the inbox', async () => {
    await db.proposals.put(proposal('p1'));
    await renderInbox();
    fireEvent.click(await screen.findByRole('button', { name: /^Review/ }));

    fireEvent.click(await screen.findByRole('button', { name: 'Accept' }));

    expect(await screen.findByText("Added to Lia's medicines")).toBeTruthy();
    expect(screen.getByText('It shows in the medicines as soon as it syncs.')).toBeTruthy();
    const [[entity, kind, payload]] = await outbox();
    expect([entity, kind]).toEqual(['proposalDecision', 'upsert']);
    expect(payload).toMatchObject({
      action: 'accept',
      acceptedOn: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    });
    expect((await db.proposals.get('p1'))?.status).toBe('accepted');
    expect(await db.prescriptions.count()).toBe(0);
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('region')).toBeNull());
  });

  it('declines with a reason of up to 500 characters that the doctor sees', async () => {
    await db.proposals.put(proposal('p1'));
    await renderInbox();
    fireEvent.click(await screen.findByRole('button', { name: /^Review/ }));

    fireEvent.click(await screen.findByRole('button', { name: 'Decline' }));
    const reason = await screen.findByRole('textbox', { name: /Reason \(optional\)/ });
    expect(reason.getAttribute('maxlength')).toBe('500');
    expect(screen.getByText('The doctor sees it.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Accept' })).toBeNull();
    fireEvent.change(reason, { target: { value: 'We will wait for the next visit.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Decline' }));

    await waitFor(async () => expect(await db.outbox.count()).toBe(1));
    expect((await outbox())[0]).toEqual([
      'proposalDecision',
      'upsert',
      { action: 'decline', reason: 'We will wait for the next visit.' },
    ]);
    expect(await db.proposals.get('p1')).toMatchObject({
      status: 'declined',
      declineReason: 'We will wait for the next visit.',
      decisionPending: true,
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.queryByRole('region')).toBeNull();
  });

  it('declines without a reason, and cancel goes back to the two choices', async () => {
    await db.proposals.put(proposal('p1'));
    await renderInbox();
    fireEvent.click(await screen.findByRole('button', { name: /^Review/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Decline' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByRole('button', { name: 'Accept' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Decline' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Decline' }));

    await waitFor(async () => expect(await db.outbox.count()).toBe(1));
    expect((await outbox())[0][2]).toEqual({ action: 'decline', reason: null });
  });
});

describe('a recommendation', () => {
  it('is read in a read-only sheet, marked read for this user, and leaves the inbox', async () => {
    await db.notes.put(recommendation('r1', { body: 'Offer 120 ml every 3 hours.' }));
    await renderInbox();

    fireEvent.click(
      await screen.findByRole('button', { name: 'Read the recommendation from Dr. Ana Souza' }),
    );

    const sheet = await screen.findByRole('dialog', { name: 'Recommendation' });
    expect(within(sheet).getByText('Offer 120 ml every 3 hours.')).toBeTruthy();
    expect(within(sheet).getByText('Dr. Ana Souza')).toBeTruthy();
    expect(within(sheet).queryByRole('textbox')).toBeNull();
    await waitFor(async () => expect(await db.noteReads.get('r1')).toBeTruthy());
    expect((await db.outbox.toArray()).map((m) => [m.entityType, m.entityId, m.payload])).toEqual([
      ['noteRead', 'read:r1', { noteId: 'r1' }],
    ]);
    fireEvent.click(within(sheet).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('region')).toBeNull());
  });
});

describe('a decided suggestion', () => {
  async function renderDetails(id: string, role: BabyRole = 'Owner') {
    const baby = await seedFamily(db, role);
    renderWithDb(db, <ProposalDetailsSheet baby={baby} proposalId={id} onClose={() => {}} />, {
      api: fakeApi().api,
    });
  }

  it('is read-only with its status, the reason and when it was decided', async () => {
    await db.proposals.put(
      proposal('p1', {
        status: 'declined',
        declineReason: 'We will wait.',
        decidedAt: '2026-10-23T09:00:00.000Z',
      }),
    );
    await renderDetails('p1');

    const sheet = await screen.findByRole('dialog', { name: 'Colidis' });
    expect(within(sheet).getByText('Declined')).toBeTruthy();
    expect(within(sheet).getByText('Declined on Oct 23, 2026')).toBeTruthy();
    expect(within(sheet).getByText('Reason: We will wait.')).toBeTruthy();
    expect(within(sheet).queryByRole('button', { name: /Accept|Decline/ })).toBeNull();
    expect(within(sheet).queryByText(/Accepting adds/)).toBeNull();
  });

  it('says it is waiting to sync while the decision is on its way', async () => {
    await db.proposals.put(
      proposal('p1', {
        status: 'accepted',
        decisionPending: true,
        decidedAt: '2026-10-23T09:00:00.000Z',
      }),
    );
    await renderDetails('p1');

    const sheet = await screen.findByRole('dialog', { name: 'Colidis' });
    expect(within(sheet).getByText('Accepted')).toBeTruthy();
    expect(within(sheet).getByText('Waiting to sync')).toBeTruthy();
    expect(within(sheet).queryByRole('button', { name: 'Accept' })).toBeNull();
  });

  it.each([
    [{ cancelReason: 'withdrawn' as const }, 'The doctor withdrew this suggestion.'],
    [
      { cancelReason: 'access_removed' as const },
      'Cancelled because the doctor no longer has access.',
    ],
  ])('explains a cancelled one (%o)', async (extra, line) => {
    await db.proposals.put(proposal('p1', { status: 'cancelled', ...extra }));
    await renderDetails('p1');

    expect(await screen.findByText(line)).toBeTruthy();
  });

  it('explains a replaced one', async () => {
    await db.proposals.put(proposal('p1', { status: 'superseded' }));
    await renderDetails('p1');

    expect(
      await screen.findByText(
        'Replaced when another suggestion for the same prescription was accepted.',
      ),
    ).toBeTruthy();
  });

  it.each<BabyRole>(['Caregiver', 'Viewer', 'Doctor'])(
    'offers a %s no decision on a pending suggestion',
    async (role) => {
      await db.proposals.put(proposal('p1'));
      await renderDetails('p1', role);

      const sheet = await screen.findByRole('dialog', { name: 'Colidis' });
      expect(within(sheet).queryByRole('button', { name: /Accept|Decline/ })).toBeNull();
      expect(within(sheet).queryByText(/Accepting adds/)).toBeNull();
    },
  );

  it('says so when the proposal is not on the device', async () => {
    await renderDetails('nope');

    expect(await screen.findByText('This suggestion is not on this device yet.')).toBeTruthy();
  });
});

describe('pt-BR', () => {
  it('reads the doctor with Dr(a)., Revisar, Aceitar and Recusar', async () => {
    await useTestLocale('pt-BR');
    await db.proposals.put(proposal('p1'));
    await db.notes.put(recommendation('r1', { author: ANA }));
    await renderInbox();

    expect(await card('Dr(a). Ana Souza sugeriu uma prescrição')).toBeTruthy();
    expect(await card('Dr(a). Ana Souza enviou uma recomendação')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Revisar a sugestão de Colidis' }));
    const sheet = await screen.findByRole('dialog', { name: 'Colidis' });
    expect(within(sheet).getByText('Sugerido por')).toBeTruthy();
    expect(within(sheet).getByText('Médico(a) autodeclarado(a)')).toBeTruthy();
    expect(
      within(sheet).getByText(
        'Ao aceitar, esta prescrição é adicionada para Lia. Você pode encerrá-la quando quiser.',
      ),
    ).toBeTruthy();
    expect(within(sheet).getByRole('button', { name: 'Aceitar' })).toBeTruthy();
    expect(within(sheet).getByRole('button', { name: 'Recusar' })).toBeTruthy();
  });
});

describe.each(['light', 'dark'] as const)('the inbox in the %s scheme', (scheme) => {
  it.each(['en', 'pt-BR'] as const)(
    'has no accessibility violations in %s, also with the details open',
    async (locale) => {
      window.localStorage.setItem(THEME_STORAGE_KEY, scheme);
      if (locale === 'pt-BR') await useTestLocale('pt-BR');
      await db.proposals.put(proposal('p1', { instructions: 'After the feed.' }));
      await db.notes.put(recommendation('r1'));
      await renderInbox();
      await screen.findAllByRole('region');
      expect(await violations()).toEqual([]);

      fireEvent.click(await screen.findByRole('button', { name: /^(Review|Revisar)/ }));
      await screen.findByRole('dialog');
      expect(await violations()).toEqual([]);
    },
    60_000,
  );
});

async function violations() {
  const result = await axe.run(document.body, {
    runOnly: ['wcag2a', 'wcag2aa'],
    rules: { 'color-contrast': { enabled: false } },
  });
  return result.violations.map(
    (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`,
  );
}
