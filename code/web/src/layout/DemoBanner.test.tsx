import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../i18n/I18nProvider';
import { AuthTestWrapper } from '../test/AuthTestWrapper';
import { fakeAuth } from '../test/fakeAuth';
import { demoAccountId, writeDemoSession } from '../auth/demo/demoSession';
import { DemoBanner } from './DemoBanner';

function renderBanner(accountId: string) {
  return render(
    <I18nProvider>
      <AuthTestWrapper auth={fakeAuth({ accountId })}>
        <DemoBanner />
      </AuthTestWrapper>
    </I18nProvider>,
  );
}

describe('DemoBanner', () => {
  afterEach(() => {
    window.localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('shows the deletion time and the two ways out in a demo', () => {
    writeDemoSession({
      accessToken: 't',
      sub: 's',
      expiresAt: new Date(Date.now() + 3 * 86_400_000).toISOString(),
    });
    renderBanner(demoAccountId('s'));
    expect(screen.getByRole('status').textContent).toMatch(/Demo: the sample data is deleted/);
    expect(screen.getByRole('button', { name: 'Create my real account' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Leave the demo' })).toBeTruthy();
  });

  it('leaves to the sign-up without carrying the data over', async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { assign });
    writeDemoSession({
      accessToken: 't',
      sub: 's',
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    renderBanner(demoAccountId('s'));
    screen.getByRole('button', { name: 'Create my real account' }).click();
    await vi.waitFor(() => expect(assign).toHaveBeenCalledWith('/?signup=1'));
    expect(window.localStorage.getItem('lotties.demo.session')).toBeNull();
  });

  it('renders nothing for a real account', () => {
    renderBanner('https://issuer.test|user-1');
    expect(screen.queryByRole('status')).toBeNull();
  });
});
