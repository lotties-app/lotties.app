import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import axe from 'axe-core';
import { Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BabyRoutineDb } from '../db/database';
import type { BabyRole } from '../db/models';
import { FromDoctorPage } from '../pages/FromDoctorPage';
import { BABY_ID, fakeApi, testDatabase } from '../test/fakeApi';
import { useTestLocale } from '../test/locale';
import { renderWithDb, settleSync } from '../test/renderApp';
import { THEME_STORAGE_KEY } from '../theme/themeStorage';
import { FromDoctorScreen } from './FromDoctorScreen';
import { proposal, recommendation, seedFamily } from './proposalKit';

/*
 * "From your doctor" (docs/design/16-doctor-access.md section 10.3): what is waiting for the
 * parents, the recommendations (unread first, marked until opened) and what was decided.
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

async function renderPage(role: BabyRole = 'Owner') {
  const baby = await seedFamily(db, role);
  return renderWithDb(db, <FromDoctorScreen baby={baby} />, { api: fakeApi().api });
}

const section = (name: string) => screen.findByRole('region', { name });
async function seedMixed() {
  await db.proposals.bulkPut([
    proposal('w-old', { medicationName: 'Waiting old', createdAt: '2026-10-21T09:00:00.000Z' }),
    proposal('w-new', { medicationName: 'Waiting new', createdAt: '2026-10-22T09:00:00.000Z' }),
    proposal('d-acc', {
      medicationName: 'Accepted one',
      status: 'accepted',
      decidedAt: '2026-10-22T12:00:00.000Z',
    }),
    proposal('d-dec', {
      medicationName: 'Declined one',
      status: 'declined',
      declineReason: 'Not now.',
      decidedAt: '2026-10-21T12:00:00.000Z',
    }),
    proposal('d-can', {
      medicationName: 'Cancelled one',
      status: 'cancelled',
      cancelReason: 'withdrawn',
      decidedAt: '2026-10-20T12:00:00.000Z',
    }),
    proposal('d-sup', {
      medicationName: 'Replaced one',
      status: 'superseded',
      decidedAt: '2026-10-19T12:00:00.000Z',
    }),
  ]);
  await db.notes.bulkPut([
    recommendation('r-read', { createdAt: '2026-10-22T10:00:00.000Z', body: 'Read one' }),
    recommendation('r-unread', { createdAt: '2026-10-21T10:00:00.000Z', body: 'Unread one' }),
    recommendation('r-private', { visibility: 'private', body: 'Private one' }),
    recommendation('r-mine', { authorUserId: 'mom', body: 'Mine' }),
  ]);
  await db.noteReads.put({ noteId: 'r-read', babyId: BABY_ID, readAt: '2026-10-22T11:00:00.000Z' });
}

describe('the page', () => {
  it('lists what waits for the parents, the recommendations and what was decided', async () => {
    await seedMixed();
    await renderPage();

    const waiting = await section('Waiting for you');
    expect(
      within(waiting)
        .getAllByRole('button')
        .map((b) => b.getAttribute('aria-label')),
    ).toEqual(['Open the suggestion for Waiting new', 'Open the suggestion for Waiting old']);
    const recommendations = screen.getByRole('region', { name: 'Recommendations' });
    // Unread first, then the read ones; never the other's private note or the reader's own.
    expect(
      within(recommendations)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual([expect.stringContaining('Unread one'), expect.stringContaining('Read one')]);
    expect(within(recommendations).getAllByText('New')).toHaveLength(1);
    const decided = screen.getByRole('region', { name: 'Decided' });
    const items = within(decided).getAllByRole('listitem');
    expect(items.map((item) => item.textContent)).toEqual([
      expect.stringContaining('Accepted one'),
      expect.stringContaining('Declined one'),
      expect.stringContaining('Cancelled one'),
      expect.stringContaining('Replaced one'),
    ]);
    expect(within(items[0]).getByText('Accepted')).toBeTruthy();
    expect(within(items[1]).getByText('Declined')).toBeTruthy();
    expect(within(items[1]).getByText('Reason: Not now.')).toBeTruthy();
    expect(within(items[2]).getByText('Cancelled')).toBeTruthy();
    expect(within(items[3]).getByText('Replaced')).toBeTruthy();
    expect(screen.queryByText('Private one')).toBeNull();
    expect(screen.queryByText('Mine')).toBeNull();
  });

  it('opens a waiting suggestion with the two choices and a decided one read-only', async () => {
    await seedMixed();
    await renderPage();

    fireEvent.click(
      await screen.findByRole('button', { name: 'Open the suggestion for Waiting new' }),
    );
    const waiting = await screen.findByRole('dialog', { name: 'Waiting new' });
    expect(within(waiting).getByRole('button', { name: 'Accept' })).toBeTruthy();
    fireEvent.click(within(waiting).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    fireEvent.click(screen.getByRole('button', { name: 'Open the suggestion for Declined one' }));
    const decided = await screen.findByRole('dialog', { name: 'Declined one' });
    expect(within(decided).getByText('Reason: Not now.')).toBeTruthy();
    expect(within(decided).queryByRole('button', { name: /Accept|Decline/ })).toBeNull();
  });

  it('marks a recommendation read when it is opened, and keeps listing it', async () => {
    await seedMixed();
    await renderPage();
    const recommendations = await section('Recommendations');
    expect(within(recommendations).getAllByText('New')).toHaveLength(1);

    fireEvent.click(within(recommendations).getAllByRole('button')[0]);

    const sheet = await screen.findByRole('dialog', { name: 'Recommendation' });
    expect(within(sheet).getByText('Unread one')).toBeTruthy();
    await waitFor(async () => expect(await db.noteReads.get('r-unread')).toBeTruthy());
    expect((await db.outbox.toArray()).map((m) => [m.entityType, m.entityId])).toEqual([
      ['noteRead', 'read:r-unread'],
    ]);
    fireEvent.click(within(sheet).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(within(recommendations).queryByText('New')).toBeNull());
    expect(within(recommendations).getAllByRole('button')).toHaveLength(2);
  });

  it('says it is empty when the doctor sent nothing', async () => {
    await renderPage();

    expect(await screen.findByText('Nothing from the doctor yet')).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Waiting for you' })).toBeNull();
  });

  it('says nothing is waiting when everything is decided', async () => {
    await db.proposals.put(proposal('d', { status: 'accepted' }));
    await renderPage();

    expect(await screen.findByText('Nothing is waiting for you.')).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Decided' })).toBeTruthy();
  });

  it.each<BabyRole>(['Caregiver', 'Viewer'])('tells a %s it is for the parents', async (role) => {
    await seedMixed();
    await renderPage(role);

    expect(
      await screen.findByText("Only the baby's parents see what the doctor sends."),
    ).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Waiting for you' })).toBeNull();
    expect(screen.queryByText('Waiting new')).toBeNull();
  });
});

describe('the route', () => {
  it('sends the Doctor to her proposals', async () => {
    await seedFamily(db, 'Doctor');
    renderWithDb(
      db,
      <Routes>
        <Route path="/" element={<FromDoctorPage />} />
        <Route path="/proposals" element={<p>MY PROPOSALS PAGE</p>} />
      </Routes>,
      { api: fakeApi().api },
    );

    expect(await screen.findByText('MY PROPOSALS PAGE')).toBeTruthy();
  });

  it('shows the page for the parents', async () => {
    await seedFamily(db, 'Parent');
    renderWithDb(db, <FromDoctorPage />, { api: fakeApi().api });

    expect(await screen.findByRole('heading', { name: 'From your doctor' })).toBeTruthy();
  });
});

describe('pt-BR', () => {
  it('reads Do seu médico, Aguardando você, Recomendações, Decididas and Nova', async () => {
    await useTestLocale('pt-BR');
    await seedMixed();
    await renderPage();

    expect(await screen.findByRole('heading', { name: 'Do seu médico' })).toBeTruthy();
    expect(await section('Aguardando você')).toBeTruthy();
    const recommendations = screen.getByRole('region', { name: 'Recomendações' });
    expect(within(recommendations).getByText('Nova')).toBeTruthy();
    const decided = screen.getByRole('region', { name: 'Decididas' });
    expect(within(decided).getByText('Recusada')).toBeTruthy();
    expect(within(decided).getByText('Substituída')).toBeTruthy();
    expect(within(decided).getByText('Motivo: Not now.')).toBeTruthy();
  });
});

describe.each(['light', 'dark'] as const)('From your doctor in the %s scheme', (scheme) => {
  it.each(['en', 'pt-BR'] as const)(
    'has no accessibility violations in %s, also with a suggestion open',
    async (locale) => {
      window.localStorage.setItem(THEME_STORAGE_KEY, scheme);
      if (locale === 'pt-BR') await useTestLocale('pt-BR');
      await seedMixed();
      await renderPage();
      await section(locale === 'en' ? 'Waiting for you' : 'Aguardando você');
      expect(await violations()).toEqual([]);

      fireEvent.click(screen.getAllByRole('button', { name: /^(Open|Abrir) / })[0]);
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
