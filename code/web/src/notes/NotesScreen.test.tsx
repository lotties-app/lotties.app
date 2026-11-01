import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BabyRoutineDb } from '../db/database';
import type { BabyRole, Note } from '../db/models';
import { BABY_ID, fakeApi, testDatabase } from '../test/fakeApi';
import { useTestLocale } from '../test/locale';
import { renderWithDb, settleSync } from '../test/renderApp';
import { seedBaby } from '../test/seed';
import { THEME_STORAGE_KEY } from '../theme/themeStorage';
import { NotesScreen } from './NotesScreen';

/* The notes of a baby (docs/design/16-doctor-access.md): the doctor writes, the family reads. */

let db: BabyRoutineDb;

const DOCTOR = 'doctor-1';
const ANA = {
  userId: DOCTOR,
  displayName: 'Ana Souza',
  professional: {
    kind: 'doctor' as const,
    displayName: 'Ana Souza',
    specialty: 'Pediatrics',
    registrationNumber: null,
    verified: false,
  },
};

const note = (id: string, extra: Partial<Note> = {}): Note => ({
  id,
  babyId: BABY_ID,
  authorUserId: DOCTOR,
  author: ANA,
  kind: 'note',
  visibility: 'shared',
  body: `Body of ${id}`,
  createdAt: '2026-10-20T10:00:00.000Z',
  updatedAt: '2026-10-20T10:00:00.000Z',
  clientUpdatedAt: '2026-10-20T10:00:00.000Z',
  deletedAt: null,
  ...extra,
});

const MEMBERS = [
  { userId: 'mom', displayName: 'Carla', role: 'Owner', joinedAt: '2026-08-01T10:00:00Z' },
  { userId: DOCTOR, displayName: 'ana', role: 'Doctor', joinedAt: '2026-10-01T10:00:00Z' },
];

beforeEach(() => {
  db = testDatabase();
});

afterEach(async () => {
  await settleSync();
  await db.delete();
});

async function renderNotes(role: BabyRole, members = MEMBERS) {
  const userId = role === 'Doctor' ? DOCTOR : 'mom';
  await seedBaby(db, { role, userId });
  const fake = fakeApi((call) => (call.path.endsWith('/members') ? members : undefined));
  renderWithDb(
    db,
    <NotesScreen baby={{ id: BABY_ID, name: 'Lia', birthDate: '2026-08-01', role, userId }} />,
    { api: fake.api },
  );
  return fake;
}

describe('notes as the doctor', () => {
  it('writes a shared note by default from the composer and queues it', async () => {
    await renderNotes('Doctor');

    fireEvent.click(await screen.findByRole('button', { name: 'Write a note' }));
    const sheet = await screen.findByRole('presentation');
    expect(
      within(sheet)
        .getByRole('radio', { name: 'Shared with parents' })
        .getAttribute('aria-checked'),
    ).toBe('true');
    fireEvent.click(within(sheet).getByRole('radio', { name: 'Recommendation' }));
    fireEvent.change(within(sheet).getByRole('textbox', { name: /^Note/ }), {
      target: { value: 'Offer 120 ml every 3 hours.' },
    });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));

    const card = await screen.findByRole('article');
    expect(within(card).getByText('Offer 120 ml every 3 hours.')).toBeTruthy();
    expect(within(card).getByText('You')).toBeTruthy();
    expect(within(card).getByText('Recommendation')).toBeTruthy();
    const [queued] = await db.outbox.toArray();
    expect(queued).toMatchObject({ entityType: 'note', kind: 'upsert' });
    expect(queued.payload).toMatchObject({ kind: 'recommendation', visibility: 'shared' });
    expect((await db.notes.toArray())[0].authorUserId).toBe(DOCTOR);
  });

  it('asks for the text before saving', async () => {
    await renderNotes('Doctor');

    fireEvent.click(await screen.findByRole('button', { name: 'Write a note' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Write the note.')).toBeTruthy();
    expect(await db.outbox.count()).toBe(0);
  });

  it('edits and deletes her own notes; a shared note cannot become private', async () => {
    await db.notes.bulkPut([
      note('a'),
      note('b', { visibility: 'private', createdAt: '2026-10-19T10:00:00.000Z' }),
    ]);
    await renderNotes('Doctor');

    const cards = await screen.findAllByRole('article');
    expect(cards).toHaveLength(2);
    expect(within(cards[1]).getByText('Private')).toBeTruthy();
    fireEvent.click(within(cards[0]).getByRole('button', { name: /^Edit note of/ }));
    const sheet = await screen.findByRole('presentation');
    expect(within(sheet).getByRole('radio', { name: 'Only me' }).hasAttribute('disabled')).toBe(
      true,
    );
    expect(within(sheet).getByText(/already shared with the parents/)).toBeTruthy();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Close' }));

    fireEvent.click(within(cards[1]).getByRole('button', { name: /^Delete note of/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete note' }));
    await waitFor(async () => expect((await db.notes.get('b'))?.deletedAt).not.toBeNull());
    expect((await db.outbox.toArray()).map((m) => m.kind)).toEqual(['delete']);
  });
});

describe('notes as a parent', () => {
  it('reads the shared notes with the doctor name and the self-declared badge, read-only', async () => {
    await db.notes.bulkPut([note('a')]);
    await renderNotes('Owner');

    const card = await screen.findByRole('article');
    expect(within(card).getByText('Dr. Ana Souza')).toBeTruthy();
    expect(within(card).getByText('Self-declared doctor')).toBeTruthy();
    expect(within(card).getByText('Shared with parents')).toBeTruthy();
    expect(within(card).queryByRole('button')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Write a note' })).toBeNull();
    expect(screen.getByText(/only the doctor who wrote a note can change it/)).toBeTruthy();
  });

  it('marks the notes of a doctor who no longer has access', async () => {
    await db.notes.bulkPut([note('a')]);
    await renderNotes('Owner', MEMBERS.slice(0, 1));

    expect(await screen.findByText('Dr. Ana Souza (no longer has access)')).toBeTruthy();
  });

  it('shows the empty state without notes', async () => {
    await renderNotes('Parent');

    expect(await screen.findByText("Notes from Lia's doctor will appear here.")).toBeTruthy();
  });
});

describe('pt-BR', () => {
  it('reads Dr(a)., Compartilhada com a família and Médico(a) autodeclarado(a)', async () => {
    await useTestLocale('pt-BR');
    await db.notes.bulkPut([note('a', { kind: 'recommendation' })]);
    await renderNotes('Owner');

    const card = await screen.findByRole('article');
    expect(within(card).getByText('Dr(a). Ana Souza')).toBeTruthy();
    expect(within(card).getByText('Médico(a) autodeclarado(a)')).toBeTruthy();
    expect(within(card).getByText('Compartilhada com a família')).toBeTruthy();
    expect(within(card).getByText('Recomendação')).toBeTruthy();
  });
});

describe.each(['light', 'dark'] as const)('notes in the %s scheme', (scheme) => {
  it.each(['en', 'pt-BR'] as const)(
    'has no accessibility violations in %s, also with the composer open',
    async (locale) => {
      window.localStorage.setItem(THEME_STORAGE_KEY, scheme);
      if (locale === 'pt-BR') await useTestLocale('pt-BR');
      await db.notes.bulkPut([note('a'), note('b', { visibility: 'private' })]);
      await renderNotes('Doctor');
      await screen.findAllByRole('article');
      expect(await violations()).toEqual([]);

      fireEvent.click(
        screen.getByRole('button', { name: locale === 'en' ? 'Write a note' : 'Escrever nota' }),
      );
      await screen.findByRole('presentation');
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
