import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppRoutes } from './AppRoutes';
import type { BabyRoutineDb } from './db/database';
import { fakeApi, httpError, testDatabase, BABY_ID, type ApiCall } from './test/fakeApi';
import { renderWithDb, settleSync } from './test/renderApp';
import { seedBaby } from './test/seed';
import { PENDING_INVITE_KEY } from './invite/inviteToken';

let db: BabyRoutineDb;

beforeEach(() => {
  db = testDatabase();
  window.sessionStorage.clear();
  window.history.replaceState(null, '', '/');
});

afterEach(async () => {
  await settleSync();
  await db.delete();
});

const THEO = { id: 'baby-2', name: 'Theo', birthDate: '2026-02-01', role: 'Parent' };
const LIA = { id: BABY_ID, name: 'Lia', birthDate: '2026-08-01', role: 'Owner' };

describe('lazy routes', () => {
  it('renders the settings, day, insights and now routes through Suspense', async () => {
    await seedBaby(db);
    const { unmount } = renderWithDb(db, <AppRoutes />, { route: '/settings' });
    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeTruthy();
    expect(screen.getByRole('navigation')).toBeTruthy();
    unmount();

    const day = renderWithDb(db, <AppRoutes />, { route: '/day' });
    expect(await screen.findByRole('heading', { name: 'Day' })).toBeTruthy();
    day.unmount();

    const insights = renderWithDb(db, <AppRoutes />, { route: '/insights' });
    expect(await screen.findByRole('heading', { name: 'Insights', level: 1 })).toBeTruthy();
    insights.unmount();

    renderWithDb(db, <AppRoutes />, { route: '/' });
    expect(await screen.findByRole('heading', { name: 'Now' })).toBeTruthy();
  });
});

describe('invite route', () => {
  function acceptHandler(call: ApiCall) {
    if (call.method === 'POST' && call.path === '/api/v1/invites/accept') return THEO;
    if (call.path === '/api/v1/babies') return [LIA, THEO];
  }

  it('accepts a fragment invite with the token in the body and scrubs the URL', async () => {
    await seedBaby(db);
    const { api, writes } = fakeApi(acceptHandler);
    renderWithDb(db, <AppRoutes />, { api, route: '/invite#tok-1' });

    // Now with the joined baby selected: the switcher shows Theo and the Now screen renders.
    expect(await screen.findByRole('button', { name: /Theo/ })).toBeTruthy();
    expect(await screen.findByRole('heading', { name: 'Now' })).toBeTruthy();
    expect(writes()).toHaveLength(1);
    expect(writes()[0]).toMatchObject({
      method: 'POST',
      path: '/api/v1/invites/accept',
      body: { token: 'tok-1' },
    });
    expect(window.localStorage.getItem('baby-routine.selected-baby')).toBe('baby-2');
    expect(await db.babies.get('baby-2')).toEqual(THEO);
    expect(window.sessionStorage.getItem(PENDING_INVITE_KEY)).toBeNull();
  });

  it('still accepts the deprecated path link and removes the token from the URL', async () => {
    await seedBaby(db);
    window.history.replaceState(null, '', '/invite/tok-1');
    const { api, writes } = fakeApi(acceptHandler);
    renderWithDb(db, <AppRoutes />, { api, route: '/invite/tok-1' });

    expect(await screen.findByRole('heading', { name: 'Now' })).toBeTruthy();
    expect(writes()[0]).toMatchObject({
      method: 'POST',
      path: '/api/v1/invites/accept',
      body: { token: 'tok-1' },
    });
    expect(window.location.pathname).toBe('/invite');
    expect(window.location.href).not.toContain('tok-1');
  });

  it('keeps the token out of the login redirect and accepts it after sign-in', async () => {
    await seedBaby(db);
    const { fakeAuth } = await import('./test/fakeAuth');
    const signedOut = fakeAuth({ isAuthenticated: false });
    const first = renderWithDb(db, <AppRoutes />, {
      api: fakeApi().api,
      route: '/invite#tok-1',
      auth: signedOut,
    });

    expect(window.sessionStorage.getItem(PENDING_INVITE_KEY)).toBe('tok-1');
    expect(window.location.href).not.toContain('tok-1');
    await waitFor(() => expect(signedOut.login).toHaveBeenCalledWith('/invite'));
    expect(await screen.findByText('Taking you to sign in')).toBeTruthy();
    first.unmount();

    // The provider returns the user to `/invite` (no token in it); the parked token is used.
    const { api, writes } = fakeApi(acceptHandler);
    renderWithDb(db, <AppRoutes />, { api, route: '/invite', auth: fakeAuth() });
    expect(await screen.findByRole('heading', { name: 'Now' })).toBeTruthy();
    expect(writes()[0]).toMatchObject({ body: { token: 'tok-1' } });
    expect(window.sessionStorage.getItem(PENDING_INVITE_KEY)).toBeNull();
  });

  it.each([
    [410, 'invite_expired', 'This invite has expired'],
    [409, 'invite_already_accepted', 'This invite was already used'],
    [404, 'invite_not_found', 'This invite link is not valid'],
    [409, 'member_already_exists', 'You are already a member'],
    [409, 'concurrent_modification', 'Something changed at the same time'],
    [429, 'rate_limited', 'Too many requests'],
  ])('explains a %i %s failure', async (status, code, message) => {
    await seedBaby(db);
    const { api } = fakeApi((call) => {
      if (call.method === 'POST') throw httpError(status, code);
    });
    renderWithDb(db, <AppRoutes />, { api, route: '/invite#tok-1' });

    expect(await screen.findByText(new RegExp(message))).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Go to Home' })).toBeTruthy();
    expect(await db.babies.count()).toBe(1);
  });

  it('sends signed-out users to sign in first (route is protected)', async () => {
    const { fakeAuth } = await import('./test/fakeAuth');
    const { api, writes } = fakeApi();
    const signedOut = fakeAuth({ isAuthenticated: false });
    renderWithDb(db, <AppRoutes />, { api, route: '/invite/tok-1', auth: signedOut });

    await waitFor(() => expect(signedOut.login).toHaveBeenCalledWith('/invite'));
    expect(writes()).toHaveLength(0);
  });
});

describe('landing and sign-in routing', () => {
  async function signedOutAuth(overrides = {}) {
    const { fakeAuth } = await import('./test/fakeAuth');
    return fakeAuth({ isAuthenticated: false, user: null, ...overrides });
  }

  const HEADLINE = /Track your baby.s day, together/;

  it('shows the landing page at / when signed out, without starting a sign-in', async () => {
    const auth = await signedOutAuth();
    renderWithDb(db, <AppRoutes />, { auth });

    expect(await screen.findByRole('heading', { level: 1, name: HEADLINE })).toBeTruthy();
    expect(screen.queryByRole('navigation')).toBeNull();
    expect(auth.login).not.toHaveBeenCalled();
  });

  it('shows the Now screen at / when signed in', async () => {
    await seedBaby(db);
    renderWithDb(db, <AppRoutes />);
    expect(await screen.findByRole('heading', { name: 'Now' })).toBeTruthy();
    expect(screen.queryByRole('heading', { level: 1, name: HEADLINE })).toBeNull();
  });

  it('redirects a deep link straight to sign-in with its path, with a calm placeholder', async () => {
    const auth = await signedOutAuth();
    renderWithDb(db, <AppRoutes />, { auth, route: '/day?d=2026-10-01' });

    await waitFor(() => expect(auth.login).toHaveBeenCalledWith('/day?d=2026-10-01'));
    expect(auth.login).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('Taking you to sign in')).toBeTruthy();
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
  });

  it('redirects the old /login path to the landing page', async () => {
    const auth = await signedOutAuth();
    renderWithDb(db, <AppRoutes />, { auth, route: '/login' });
    expect(await screen.findByRole('heading', { level: 1, name: HEADLINE })).toBeTruthy();
    expect(auth.login).not.toHaveBeenCalled();
  });

  it('shows the landing page with an error card after a failed sign-in, and does not loop', async () => {
    const auth = await signedOutAuth({ error: new Error('access_denied') });
    renderWithDb(db, <AppRoutes />, { auth, route: '/settings' });

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText('Sign-in did not work')).toBeTruthy();
    expect(auth.login).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    // The retry goes back to the page the visitor wanted.
    expect(auth.login).toHaveBeenCalledWith('/settings', undefined);
    expect(auth.login).toHaveBeenCalledTimes(1);
  });

  it('explains an ended session on the landing page instead of redirecting', async () => {
    const auth = await signedOutAuth({ sessionEnded: true });
    renderWithDb(db, <AppRoutes />, { auth, route: '/day' });

    expect(await screen.findByText('Your session ended')).toBeTruthy();
    expect(auth.login).not.toHaveBeenCalled();
  });

  it('starts sign-in and registration from the hero buttons', async () => {
    const auth = await signedOutAuth();
    renderWithDb(db, <AppRoutes />, { auth });
    await screen.findByRole('heading', { level: 1 });

    fireEvent.click(screen.getAllByRole('button', { name: 'Sign in' })[1]);
    expect(auth.login).toHaveBeenLastCalledWith('/', undefined);
    fireEvent.click(screen.getByRole('button', { name: 'Create an account' }));
    expect(auth.login).toHaveBeenLastCalledWith('/', { register: true });
  });

  it('waits while the stored session is still being read', async () => {
    const auth = await signedOutAuth({ isLoading: true });
    renderWithDb(db, <AppRoutes />, { auth });
    expect(await screen.findByLabelText('Loading')).toBeTruthy();
    expect(auth.login).not.toHaveBeenCalled();
  });
});
