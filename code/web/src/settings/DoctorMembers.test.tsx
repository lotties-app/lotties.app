import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BabyRoutineDb } from '../db/database';
import { BABY_ID, fakeApi, testDatabase } from '../test/fakeApi';
import { useTestLocale } from '../test/locale';
import { renderWithDb, settleSync } from '../test/renderApp';
import { seedBaby } from '../test/seed';
import { THEME_STORAGE_KEY } from '../theme/themeStorage';
import { MembersSection } from './MembersSection';

/*
 * Members with a doctor: the Doctor invite with its consent line and the sections to share, her row
 * with what she sees and the "Doctor access" sheet, the access log (docs/design/19-doctor-dashboard.md).
 */

let db: BabyRoutineDb;

const PROFILE = {
  kind: 'doctor',
  displayName: 'Ana Souza',
  specialty: 'Pediatrics',
  verified: false,
};
const MEMBERS = [
  { userId: 'mom', displayName: 'Carla', role: 'Owner', joinedAt: '2026-08-01T10:00:00Z' },
  {
    userId: 'doc',
    displayName: 'ana.s',
    role: 'Doctor',
    joinedAt: '2026-10-01T10:00:00Z',
    professional: PROFILE,
    doctorScopes: ['daily_log', 'growth', 'notes'],
  },
];
const LOG = [
  {
    userId: 'doc',
    person: { userId: 'doc', displayName: 'Ana Souza', professional: PROFILE },
    role: 'Doctor',
    kind: 'view',
    at: '2026-10-21T14:05:00Z',
  },
];

beforeEach(async () => {
  db = testDatabase();
  await seedBaby(db);
});

afterEach(async () => {
  await settleSync();
  await db.delete();
});

function renderMembers(log: unknown[] = LOG) {
  const fake = fakeApi((call) => {
    if (call.path.endsWith('/members')) return MEMBERS;
    if (call.path.endsWith('/access-log')) return log;
    if (call.path.endsWith('/members/doc') && call.method === 'PATCH') {
      return {
        ...MEMBERS[1],
        doctorScopes: (call.body as { doctorScopes: string[] }).doctorScopes,
      };
    }
    if (call.path.endsWith('/invites') && call.method === 'POST') {
      return {
        id: 'i1',
        babyId: BABY_ID,
        role: 'Doctor',
        createdBy: 'mom',
        createdAt: '2026-10-21T10:00:00Z',
        expiresAt: '2026-10-28T10:00:00Z',
        token: 'tok',
      };
    }
    return undefined;
  });
  renderWithDb(
    db,
    <MembersSection baby={{ id: BABY_ID, name: 'Lia', birthDate: '2026-08-01', role: 'Owner' }} />,
    { api: fake.api },
  );
  return fake;
}

describe('members with a doctor', () => {
  it('shows the doctor with the self-declared badge and only a remove button', async () => {
    renderMembers();

    const list = await screen.findByRole('list', { name: 'Members' });
    const doctorRow = (await within(list).findByText('Dr. Ana Souza')).closest('li')!;
    expect(within(doctorRow).getByText('Self-declared doctor')).toBeTruthy();
    expect(within(doctorRow).queryByRole('combobox')).toBeNull();
    fireEvent.click(within(doctorRow).getByRole('button', { name: 'Remove ana.s' }));
    expect(
      await screen.findByText(/The notes they shared stay visible to the family/),
    ).toBeTruthy();
  });

  it('invites a doctor with the consent line and the sections to share, all on by default', async () => {
    const fake = renderMembers();

    fireEvent.mouseDown(await screen.findByRole('combobox', { name: 'Invite role' }));
    fireEvent.click(await screen.findByRole('option', { name: /^Doctor/ }));
    expect(
      await screen.findByText(
        'The doctor who accepts will see the sections you choose for Lia and can add notes and measurements. You can change what you share or remove access at any time.',
      ),
    ).toBeTruthy();
    const sections = screen.getByRole('group', { name: 'What the doctor sees' });
    const switches = within(sections).getAllByRole('switch');
    expect(switches).toHaveLength(6);
    expect(switches.every((toggle) => (toggle as HTMLInputElement).checked)).toBe(true);
    expect(within(sections).getByText('Weight, length and head measurements.')).toBeTruthy();
    expect(
      screen.getByText('Appointments, members and settings are never shared with doctors.'),
    ).toBeTruthy();
    fireEvent.click(within(sections).getByRole('switch', { name: /^Formulas/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Create invite link' }));

    await waitFor(() => expect(fake.writes()).toHaveLength(1));
    expect(fake.writes()[0].body).toEqual({
      role: 'Doctor',
      expiresInDays: 7,
      doctorScopes: ['daily_log', 'growth', 'medications', 'vaccines', 'notes'],
    });
  });

  it('warns that a doctor with no section sees only the name and age', async () => {
    renderMembers();

    fireEvent.mouseDown(await screen.findByRole('combobox', { name: 'Invite role' }));
    fireEvent.click(await screen.findByRole('option', { name: /^Doctor/ }));
    const sections = await screen.findByRole('group', { name: 'What the doctor sees' });
    for (const toggle of within(sections).getAllByRole('switch')) fireEvent.click(toggle);

    expect(
      screen.getByText("With every section off, the doctor sees only the baby's name and age."),
    ).toBeTruthy();
  });

  it('sends no sections with another role', async () => {
    const fake = renderMembers();

    fireEvent.click(await screen.findByRole('button', { name: 'Create invite link' }));

    await waitFor(() => expect(fake.writes()).toHaveLength(1));
    expect(fake.writes()[0].body).toEqual({ role: 'Parent', expiresInDays: 7 });
  });

  it('shows what the doctor sees and changes it in "Doctor access"', async () => {
    const fake = renderMembers();

    const list = await screen.findByRole('list', { name: 'Members' });
    const doctorRow = (await within(list).findByText('Dr. Ana Souza')).closest('li')!;
    expect(within(doctorRow).getByText('Sees: daily log, growth, and notes')).toBeTruthy();
    fireEvent.click(within(doctorRow).getByRole('button', { name: 'Doctor access of ana.s' }));

    const sheet = await screen.findByRole('presentation');
    expect(
      within(sheet).getByText('Choose what Dr. Ana Souza sees of Lia. Changes apply right away.'),
    ).toBeTruthy();
    const save = within(sheet).getByRole('button', { name: 'Save' });
    expect((save as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(sheet).getByRole('switch', { name: /^Notes/ }));
    fireEvent.click(within(sheet).getByRole('switch', { name: /^Vaccines/ }));
    fireEvent.click(save);

    await waitFor(() => expect(fake.writes()).toHaveLength(1));
    expect(fake.writes()[0]).toMatchObject({
      method: 'PATCH',
      path: `/api/v1/babies/${BABY_ID}/members/doc`,
      body: { doctorScopes: ['daily_log', 'growth', 'vaccines'] },
    });
    await waitFor(() => expect(screen.queryByRole('presentation')).toBeNull());
  });

  it('names what each doctor sees above the access log', async () => {
    renderMembers();

    expect(
      await screen.findByText('Dr. Ana Souza sees: daily log, growth, and notes'),
    ).toBeTruthy();
  });

  it('lists the access log for the owner', async () => {
    renderMembers();

    const log = await screen.findByRole('list', { name: 'Access log' });
    expect(within(log).getByText('Dr. Ana Souza')).toBeTruthy();
    expect(log.textContent).toContain('Doctor ·');
  });

  it('says when no doctor opened the data yet', async () => {
    renderMembers([]);

    expect(await screen.findByText("No doctor has opened Lia's data yet.")).toBeTruthy();
  });

  it('reads Registro de acessos and the consent line in pt-BR', async () => {
    await useTestLocale('pt-BR');
    renderMembers();

    expect(await screen.findByRole('list', { name: 'Registro de acessos' })).toBeTruthy();
    fireEvent.mouseDown(await screen.findByRole('combobox', { name: 'Papel do convite' }));
    fireEvent.click(await screen.findByRole('option', { name: /^Médico\(a\)/ }));
    expect(
      await screen.findByText(
        /Você pode mudar o que compartilha ou remover o acesso a qualquer momento/,
      ),
    ).toBeTruthy();
    expect(screen.getByRole('group', { name: 'O que o(a) médico(a) vê' })).toBeTruthy();
    expect(
      screen.getByText('Consultas, membros e ajustes nunca são compartilhados com médicos.'),
    ).toBeTruthy();
  });

  it.each(['light', 'dark'] as const)(
    'has no accessibility violations (%s)',
    async (scheme) => {
      window.localStorage.setItem(THEME_STORAGE_KEY, scheme);
      renderMembers();
      await screen.findByRole('list', { name: 'Access log' });
      const result = await axe.run(document.body, {
        runOnly: ['wcag2a', 'wcag2aa'],
        rules: { 'color-contrast': { enabled: false } },
      });
      expect(result.violations.map((v) => v.id)).toEqual([]);
    },
    60_000,
  );
});
