import { fireEvent, screen, waitFor } from '@testing-library/react';
import axe from 'axe-core';
import { Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BabyRoutineDb } from '../db/database';
import { stashPendingInvite } from '../invite/inviteToken';
import { InvitePage } from '../pages/InvitePage';
import { ProfessionalSection } from '../settings/ProfessionalSection';
import { BABY_ID, fakeApi, httpError, testDatabase, type ApiCall } from '../test/fakeApi';
import { useTestLocale } from '../test/locale';
import { renderWithDb, settleSync } from '../test/renderApp';
import { THEME_STORAGE_KEY } from '../theme/themeStorage';

/* The professional profile (docs/design/16-doctor-access.md): Settings, and a Doctor invite. */

let db: BabyRoutineDb;

const PROFILE_PATH = '/api/v1/me/professional-profile';
const STORED = {
  userId: 'doctor-1',
  kind: 'doctor',
  displayName: 'Ana Souza',
  specialty: 'Pediatrics',
  registrationNumber: 'CRM-SP 123456',
  verified: false,
  createdAt: '2026-10-20T10:00:00Z',
  updatedAt: '2026-10-20T10:00:00Z',
};

beforeEach(() => {
  db = testDatabase();
});

afterEach(async () => {
  await settleSync();
  await db.delete();
});

function profileApi(stored: typeof STORED | null) {
  return fakeApi((call: ApiCall) => {
    if (call.path !== PROFILE_PATH) return undefined;
    if (call.method === 'PUT') return { ...STORED, ...(call.body as object) };
    if (!stored) throw httpError(404, 'professional_profile_not_found');
    return stored;
  });
}

describe('Settings > I am a healthcare professional', () => {
  it('declares a profile: name required, optional specialty and registration, never verified', async () => {
    const fake = profileApi(null);
    renderWithDb(db, <ProfessionalSection />, { api: fake.api });

    expect(
      await screen.findByText(/Self-declared: Lotties does not check registrations/),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Enter the name families will see.')).toBeTruthy();
    expect(fake.writes()).toHaveLength(0);

    fireEvent.change(screen.getByRole('textbox', { name: /^Name shown to families/ }), {
      target: { value: ' Ana Souza ' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: /^Registration number/ }), {
      target: { value: 'CRM-SP 123456' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(fake.writes()).toHaveLength(1));
    expect(fake.writes()[0].body).toEqual({
      kind: 'doctor',
      displayName: 'Ana Souza',
      specialty: null,
      registrationNumber: 'CRM-SP 123456',
    });
    expect(await screen.findByText('Your professional profile')).toBeTruthy();
    expect(screen.getByText('Self-declared doctor')).toBeTruthy();
  });

  it('edits a stored profile', async () => {
    renderWithDb(db, <ProfessionalSection />, { api: profileApi(STORED).api });

    const name = (await screen.findByRole('textbox', {
      name: /^Name shown to families/,
    })) as HTMLInputElement;
    expect(name.value).toBe('Ana Souza');
    expect((screen.getByRole('textbox', { name: /^Specialty/ }) as HTMLInputElement).value).toBe(
      'Pediatrics',
    );
  });

  it.each(['light', 'dark'] as const)(
    'has no accessibility violations (%s, en and pt-BR)',
    async (scheme) => {
      window.localStorage.setItem(THEME_STORAGE_KEY, scheme);
      const view = renderWithDb(db, <ProfessionalSection />, { api: profileApi(STORED).api });
      await screen.findByRole('textbox', { name: /^Name shown to families/ });
      expect(await violations()).toEqual([]);
      view.unmount();

      await useTestLocale('pt-BR');
      renderWithDb(db, <ProfessionalSection />, { api: profileApi(STORED).api });
      await screen.findByRole('textbox', { name: /^Nome que as famílias veem/ });
      expect(await violations()).toEqual([]);
    },
    60_000,
  );
});

describe('accepting a Doctor invite', () => {
  it('asks for the profile inline, then joins and says what the family shared', async () => {
    stashPendingInvite('tok-123');
    let declared = false;
    const lia = {
      id: BABY_ID,
      name: 'Lia',
      birthDate: '2026-08-01',
      role: 'Doctor',
      userId: 'doctor-1',
      doctorScopes: ['daily_log', 'growth', 'notes'],
    };
    const fake = fakeApi((call) => {
      if (call.path === '/api/v1/babies') return [lia];
      if (call.path === '/api/v1/invites/accept') {
        if (!declared) throw httpError(422, 'professional_profile_required');
        return lia;
      }
      if (call.path === PROFILE_PATH && call.method === 'PUT') {
        declared = true;
        return STORED;
      }
      return undefined;
    });
    renderWithDb(
      db,
      <Routes>
        <Route path="/invite" element={<InvitePage />} />
        <Route path="/doctor/*" element={<p>Dashboard page</p>} />
      </Routes>,
      { api: fake.api, route: '/invite' },
    );

    expect(await screen.findByRole('heading', { name: "Join as the baby's doctor" })).toBeTruthy();
    fireEvent.change(screen.getByRole('textbox', { name: /^Name shown to families/ }), {
      target: { value: 'Ana Souza' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save and join' }));

    expect(await screen.findByRole('heading', { name: 'You now follow Lia' })).toBeTruthy();
    expect(screen.getByText('Shared with you: daily log, growth, and notes.')).toBeTruthy();
    expect(screen.getByText('You see only what the family shared.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open Lia' }).getAttribute('href')).toBe(
      `/doctor/${BABY_ID}`,
    );
    fireEvent.click(screen.getByRole('link', { name: 'Go to my patients' }));
    expect(await screen.findByText('Dashboard page')).toBeTruthy();
    const accepts = fake.calls.filter((c) => c.path === '/api/v1/invites/accept');
    expect(accepts.map((c) => c.body)).toEqual([{ token: 'tok-123' }, { token: 'tok-123' }]);
    expect((await db.babies.get(BABY_ID))?.role).toBe('Doctor');
  });
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
