import { render, screen } from '@testing-library/react';
import { Route, Routes, useLocation } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { RequireAuth } from './RequireAuth';
import { AuthTestWrapper } from '../test/AuthTestWrapper';
import { fakeAuth } from '../test/fakeAuth';

function LoginProbe() {
  const state = useLocation().state as { from?: string } | null;
  return <p>login from {state?.from}</p>;
}

function renderGuard(auth = fakeAuth(), route = '/timeline?x=1') {
  render(
    <AuthTestWrapper auth={auth} route={route}>
      <Routes>
        <Route path="/login" element={<LoginProbe />} />
        <Route element={<RequireAuth />}>
          <Route path="/timeline" element={<p>secret</p>} />
        </Route>
      </Routes>
    </AuthTestWrapper>,
  );
}

describe('RequireAuth', () => {
  it('redirects unauthenticated users to login, remembering the original path', () => {
    renderGuard(fakeAuth({ isAuthenticated: false, user: null }));
    expect(screen.queryByText('secret')).toBeNull();
    expect(screen.getByText('login from /timeline?x=1')).toBeTruthy();
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
