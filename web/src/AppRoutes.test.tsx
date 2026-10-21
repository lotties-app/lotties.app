import { fireEvent, screen } from '@testing-library/react';
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
  it('renders the settings, timeline and home routes through Suspense', async () => {
    await seedBaby(db);
    const { unmount } = renderWithDb(db, <AppRoutes />, { route: '/settings' });
    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeTruthy();
    expect(screen.getByRole('navigation')).toBeTruthy();
    unmount();

    const timeline = renderWithDb(db, <AppRoutes />, { route: '/timeline' });
    expect(await screen.findByRole('heading', { name: 'Timeline' })).toBeTruthy();
    timeline.unmount();

    renderWithDb(db, <AppRoutes />, { route: '/' });
    expect(await screen.findByRole('button', { name: /^Log Diaper/ })).toBeTruthy();
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

    // Home with the joined baby selected: the switcher shows Theo and the quick actions render.
    expect(await screen.findByRole('button', { name: /Theo/ })).toBeTruthy();
    expect(await screen.findByRole('button', { name: /^Log Diaper/ })).toBeTruthy();
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

    expect(await screen.findByRole('button', { name: /^Log Diaper/ })).toBeTruthy();
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
    fireEvent.click(await screen.findByRole('button', { name: 'Sign in' }));
    expect(signedOut.login).toHaveBeenCalledWith('/invite');
    first.unmount();

    // The provider returns the user to `/invite` (no token in it); the parked token is used.
    const { api, writes } = fakeApi(acceptHandler);
    renderWithDb(db, <AppRoutes />, { api, route: '/invite', auth: fakeAuth() });
    expect(await screen.findByRole('button', { name: /^Log Diaper/ })).toBeTruthy();
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

  it('asks signed-out users to sign in first (route is protected)', async () => {
    const { fakeAuth } = await import('./test/fakeAuth');
    const { api, writes } = fakeApi();
    renderWithDb(db, <AppRoutes />, {
      api,
      route: '/invite/tok-1',
      auth: fakeAuth({ isAuthenticated: false }),
    });

    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeTruthy();
    expect(writes()).toHaveLength(0);
  });
});
