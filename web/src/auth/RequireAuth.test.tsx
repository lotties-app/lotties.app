import { render, screen, waitFor } from '@testing-library/react';
import { Route, Routes, useLocation } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { RequireAuth } from './RequireAuth';
import { AuthTestWrapper } from '../test/AuthTestWrapper';
import { fakeAuth } from '../test/fakeAuth';

function LandingProbe() {
  const state = useLocation().state as { from?: string } | null;
  return <p>landing from {state?.from}</p>;
}

function renderGuard(auth = fakeAuth(), route = '/timeline?x=1') {
  render(
    <AuthTestWrapper auth={auth} route={route}>
      <Routes>
        <Route path="/" element={<LandingProbe />} />
        <Route element={<RequireAuth />}>
          <Route path="/timeline" element={<p>secret</p>} />
        </Route>
      </Routes>
    </AuthTestWrapper>,
  );
}

describe('RequireAuth', () => {
  it('sends unauthenticated users straight to sign-in, remembering the original path', async () => {
    const auth = fakeAuth({ isAuthenticated: false, user: null });
    renderGuard(auth);
    expect(screen.queryByText('secret')).toBeNull();
    await waitFor(() => expect(auth.login).toHaveBeenCalledWith('/timeline?x=1'));
    expect(await screen.findByText('Taking you to sign in')).toBeTruthy();
  });

  it.each([
    ['a sign-in error', { error: new Error('access_denied') }],
    ['an ended session', { sessionEnded: true }],
  ])('shows the landing page instead of redirecting after %s (no loop)', (_, overrides) => {
    const auth = fakeAuth({ isAuthenticated: false, user: null, ...overrides });
    renderGuard(auth);
    expect(screen.getByText('landing from /timeline?x=1')).toBeTruthy();
    expect(auth.login).not.toHaveBeenCalled();
  });

  it('falls back to the landing page when the redirect cannot start', async () => {
    const auth = fakeAuth({
      isAuthenticated: false,
      user: null,
      login: vi.fn(async () => {
        throw new Error('metadata unreachable');
      }),
    });
    renderGuard(auth);
    expect(await screen.findByText('landing from /timeline?x=1')).toBeTruthy();
    expect(auth.login).toHaveBeenCalledTimes(1);
  });

  it('renders the protected route when authenticated', () => {
    renderGuard();
    expect(screen.getByText('secret')).toBeTruthy();
  });

  it('shows a spinner while loading', () => {
    renderGuard(fakeAuth({ isAuthenticated: false, isLoading: true }));
    expect(screen.getByLabelText('Loading')).toBeTruthy();
    expect(screen.queryByText('secret')).toBeNull();
  });
});
