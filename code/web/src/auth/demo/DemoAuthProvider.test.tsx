import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAuth } from '../useAuth';
import { DemoAuthProvider } from './DemoAuthProvider';

const assign = vi.fn();

function Probe() {
  const auth = useAuth();
  return (
    <>
      <p>{auth.accountId}</p>
      <p>{String(auth.isAuthenticated)}</p>
      <button onClick={() => void auth.logout()}>out</button>
      <button onClick={() => void auth.login('/', { register: true })}>register</button>
    </>
  );
}

describe('DemoAuthProvider', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    window.localStorage.clear();
    assign.mockClear();
  });

  it('is signed in as the demo account, and creating an account ends the demo', async () => {
    vi.stubGlobal('location', { assign });
    window.localStorage.setItem('lotties.demo.session', '{}');
    const session = { accessToken: 'tok', sub: 'demo-1', expiresAt: '2999-01-01T00:00:00Z' };
    render(
      <DemoAuthProvider session={session}>
        <Probe />
      </DemoAuthProvider>,
    );
    expect(screen.getByText('urn:lotties:demo|demo-1')).toBeTruthy();
    expect(screen.getByText('true')).toBeTruthy();
    screen.getByText('register').click();
    await vi.waitFor(() => expect(assign).toHaveBeenCalledWith('/?signup=1'));
    expect(window.localStorage.getItem('lotties.demo.session')).toBeNull();
  });

  it('ends an already expired demo', async () => {
    vi.stubGlobal('location', { assign });
    render(
      <DemoAuthProvider session={{ accessToken: 't', sub: 's', expiresAt: '2000-01-01T00:00:00Z' }}>
        <Probe />
      </DemoAuthProvider>,
    );
    await vi.waitFor(() => expect(assign).toHaveBeenCalledWith('/'));
  });
});
