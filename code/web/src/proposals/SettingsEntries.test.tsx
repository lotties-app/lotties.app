import { screen, waitFor } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BabyRoutineDb } from '../db/database';
import type { BabyRole } from '../db/models';
import { BABY_ID, fakeApi, testDatabase } from '../test/fakeApi';
import { useTestLocale } from '../test/locale';
import { renderWithDb, settleSync } from '../test/renderApp';
import { THEME_STORAGE_KEY } from '../theme/themeStorage';
import { MEMBERS, proposal, recommendation, seedFamily } from './proposalKit';
import { DoctorSettingsEntries } from './SettingsEntries';

/*
 * The Settings entries of the doctor's data (docs/design/16-doctor-access.md section 10): Notes with
 * the unread recommendations, "From your doctor" with pending proposals plus unread recommendations,
 * "My proposals" for the Doctor.
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

async function renderEntries(role: BabyRole = 'Owner', members: unknown[] = MEMBERS) {
  const baby = await seedFamily(db, role);
  const fake = fakeApi((call) => (call.path.endsWith('/members') ? members : undefined));
  renderWithDb(db, <DoctorSettingsEntries baby={baby} />, { api: fake.api });
}

const link = (name: RegExp) => screen.findByRole('link', { name });
const links = () => screen.getAllByRole('link').map((a) => a.textContent);

async function seedInbox() {
  await db.proposals.bulkPut([
    proposal('p1'),
    proposal('p2'),
    proposal('p3', { status: 'accepted' }),
  ]);
  await db.notes.bulkPut([recommendation('r1'), recommendation('r2'), recommendation('r3')]);
  await db.noteReads.put({ noteId: 'r3', babyId: BABY_ID, readAt: '2026-10-22T10:00:00.000Z' });
}

describe('the parents', () => {
  it('count the pending proposals and the unread recommendations on "From your doctor"', async () => {
    await seedInbox();
    await renderEntries('Owner');

    const row = await link(/^From your doctor/);
    expect(row.getAttribute('href')).toBe('/from-doctor');
    expect(row.textContent).toContain('4 new from your doctor');
    expect(row.querySelector('.MuiChip-label')?.textContent).toBe('4');
  });

  it('count only the unread recommendations on Notes, and the badge drops once they are read', async () => {
    await seedInbox();
    await renderEntries('Parent');

    const notes = await link(/^Notes/);
    expect(notes.getAttribute('href')).toBe('/notes');
    await waitFor(() => expect(notes.textContent).toContain('2 new from your doctor'));

    await db.noteReads.bulkPut([
      { noteId: 'r1', babyId: BABY_ID, readAt: '2026-10-22T11:00:00.000Z' },
      { noteId: 'r2', babyId: BABY_ID, readAt: '2026-10-22T11:00:00.000Z' },
    ]);
    await waitFor(() => expect(notes.textContent).not.toContain('new from your doctor'));
    const row = screen.getByRole('link', { name: /^From your doctor/ });
    expect(row.textContent).toContain('2 new from your doctor');
  });

  it('show "From your doctor" when the baby has a doctor, even with nothing yet, without a badge', async () => {
    await renderEntries('Owner');

    const row = await link(/^From your doctor/);
    expect(row.textContent).toBe('From your doctor');
  });

  it('show it when something is on the device even without a doctor member', async () => {
    await db.proposals.put(proposal('p1', { status: 'declined' }));
    await renderEntries('Owner', MEMBERS.slice(0, 1));

    const row = await link(/^From your doctor/);
    expect(row.textContent).toBe('From your doctor');
  });

  it('hide it when there is no doctor and nothing from one', async () => {
    await renderEntries('Owner', MEMBERS.slice(0, 1));

    await link(/^Notes/);
    expect(screen.queryByRole('link', { name: /From your doctor/ })).toBeNull();
    expect(screen.queryByRole('link', { name: /My proposals/ })).toBeNull();
  });
});

describe('everyone else', () => {
  it('gives the Doctor "My proposals" and Notes, no inbox and no badge', async () => {
    await seedInbox();
    await renderEntries('Doctor');

    await link(/^My proposals/);
    expect(links()).toEqual(['Notes', 'My proposals']);
    expect(screen.getByRole('link', { name: 'My proposals' }).getAttribute('href')).toBe(
      '/proposals',
    );
  });

  it.each<BabyRole>(['Caregiver', 'Viewer'])('gives a %s Notes only', async (role) => {
    await seedInbox();
    await renderEntries(role);

    await link(/^Notes/);
    expect(links()).toEqual(['Notes']);
  });
});

describe('pt-BR', () => {
  it('reads Do seu médico and the badge in Portuguese', async () => {
    await useTestLocale('pt-BR');
    await seedInbox();
    await renderEntries('Owner');

    const row = await link(/^Do seu médico/);
    expect(row.textContent).toContain('4 novos do seu médico');
    expect(screen.getByRole('link', { name: /^Notas/ }).textContent).toContain(
      '2 novos do seu médico',
    );
  });
});

describe.each(['light', 'dark'] as const)('the entries in the %s scheme', (scheme) => {
  it.each(['en', 'pt-BR'] as const)('have no accessibility violations in %s', async (locale) => {
    window.localStorage.setItem(THEME_STORAGE_KEY, scheme);
    if (locale === 'pt-BR') await useTestLocale('pt-BR');
    await seedInbox();
    await renderEntries('Owner');
    await link(/^(From your doctor|Do seu médico)/);

    const result = await axe.run(document.body, {
      runOnly: ['wcag2a', 'wcag2aa'],
      rules: { 'color-contrast': { enabled: false } },
    });
    expect(result.violations.map((v) => v.id)).toEqual([]);
  });
});
