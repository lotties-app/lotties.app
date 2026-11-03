import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { AppRoutes } from '../AppRoutes';
import { I18nProvider } from '../i18n/I18nProvider';
import { AppThemeProvider } from '../theme/AppThemeProvider';
import { AuthTestWrapper } from '../test/AuthTestWrapper';
import { fakeAuth } from '../test/fakeAuth';

function renderPage() {
  const auth = fakeAuth({ isAuthenticated: false, user: null });
  render(
    <I18nProvider>
      <AppThemeProvider>
        <AuthTestWrapper auth={auth} route="/voice-commands">
          <AppRoutes />
        </AuthTestWrapper>
      </AppThemeProvider>
    </I18nProvider>,
  );
  return auth;
}

beforeEach(() => {
  window.localStorage.clear();
});

describe('the public /voice-commands route', () => {
  it('opens without signing in, with the shared screen of the in-app page', async () => {
    const auth = renderPage();
    expect(await screen.findByRole('heading', { level: 1, name: 'Voice commands' })).toBeTruthy();
    expect(auth.login).not.toHaveBeenCalled();
    expect(screen.getByRole('main')).toBeTruthy();
    expect(screen.getByRole('banner')).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Alexa' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Siri' })).toBeTruthy();
    await waitFor(() => expect(document.title).toBe('Voice commands · Lotties'));
  });
});
