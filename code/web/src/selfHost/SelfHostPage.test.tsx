import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppRoutes } from '../AppRoutes';
import { I18nProvider } from '../i18n/I18nProvider';
import { LOCALE_STORAGE_KEY } from '../i18n/localeStorage';
import { AppThemeProvider } from '../theme/AppThemeProvider';
import { THEME_STORAGE_KEY } from '../theme/themeStorage';
import { AuthTestWrapper } from '../test/AuthTestWrapper';
import { fakeAuth } from '../test/fakeAuth';

function renderPage() {
  const auth = fakeAuth({ isAuthenticated: false, user: null });
  const view = render(
    <I18nProvider>
      <AppThemeProvider>
        <AuthTestWrapper auth={auth} route="/self-host">
          <AppRoutes />
        </AuthTestWrapper>
      </AppThemeProvider>
    </I18nProvider>,
  );
  return { auth, ...view };
}

const type = (label: string | RegExp, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

async function fillRequired() {
  await screen.findByRole('heading', { level: 1 });
  type(/^Public address/, 'https://baby.example.com');
  type(/^Sign-in provider address/, 'https://id.example.com/realms/home');
  type(/^Client id/, 'lotties-web');
  type(/^API audience/, 'lotties-api');
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the public /self-host route', () => {
  it('opens without signing in and says who is responsible', async () => {
    const { auth } = renderPage();
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Run Lotties yourself' }),
    ).toBeTruthy();
    expect(screen.getByText(/you are the operator/)).toBeTruthy();
    expect(screen.getByText(/not a medical app/)).toBeTruthy();
    expect(auth.login).not.toHaveBeenCalled();
    await waitFor(() => expect(document.title).toBe('Run Lotties yourself · Lotties'));
  });

  it('shows the page in Portuguese', async () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'pt-BR');
    renderPage();
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Rode o Lotties por conta própria' }),
    ).toBeTruthy();
    expect(screen.getByText(/você é o operador/)).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Gerador de configuração' })).toBeTruthy();
  });

  it('asks for the required values before showing any file', async () => {
    renderPage();
    await screen.findByRole('heading', { level: 1 });
    expect(screen.getByText(/Fill in the fields marked above/)).toBeTruthy();
    expect(screen.queryByRole('heading', { name: '.env' })).toBeNull();
  });

  it('writes the .env and the compose file once the values are valid', async () => {
    renderPage();
    await fillRequired();
    const env = await screen.findByRole('heading', { level: 4, name: '.env' });
    const envBlock = within(env.closest('section')!).getByLabelText('.env', { selector: 'pre' });
    expect(envBlock.textContent).toContain('AUTH_AUTHORITY=https://id.example.com/realms/home');
    expect(envBlock.textContent).toMatch(/DB_APP_PASSWORD=[A-Za-z0-9]{32}\n/);
    const composeBlock = screen.getByLabelText('docker-compose.yml', { selector: 'pre' });
    expect(composeBlock.textContent).toContain('image: postgres:16');
    expect(composeBlock.textContent).not.toMatch(/DB_APP_PASSWORD=[A-Za-z0-9]{32}/);
    expect(screen.getByText('https://baby.example.com/auth/callback')).toBeTruthy();
  });

  it('shows a field error and keeps the files hidden for a bad address', async () => {
    renderPage();
    await fillRequired();
    type(/^Sign-in provider address/, 'http://id.example.com');
    expect(await screen.findByText(/Use an https:\/\/ address/)).toBeTruthy();
    expect(screen.queryByRole('heading', { level: 4, name: '.env' })).toBeNull();
  });

  it('makes a new password on request', async () => {
    renderPage();
    await fillRequired();
    const field = screen.getByLabelText(/^Database password/) as HTMLInputElement;
    const before = field.value;
    fireEvent.click(screen.getByRole('button', { name: 'Make a new password' }));
    expect((screen.getByLabelText(/^Database password/) as HTMLInputElement).value).not.toBe(
      before,
    );
  });

  it('makes a VAPID pair when push is turned on', async () => {
    renderPage();
    await fillRequired();
    fireEvent.click(screen.getByRole('switch', { name: /Turn on push notifications/ }));
    await waitFor(() =>
      expect((screen.getByLabelText(/^VAPID public key/) as HTMLInputElement).value).toMatch(
        /^[A-Za-z0-9_-]{87}$/,
      ),
    );
    expect((screen.getByLabelText(/^VAPID private key/) as HTMLInputElement).value).toMatch(
      /^[A-Za-z0-9_-]{43}$/,
    );
  });

  it('copies a file and never touches storage or the network', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    try {
      renderPage();
      await fillRequired();
      setItem.mockClear();
      const copy = (await screen.findAllByRole('button', { name: 'Copy' }))[0];
      fireEvent.click(copy);
      await waitFor(() => expect(writeText).toHaveBeenCalledOnce());
      expect(writeText.mock.calls[0][0]).toContain('DB_APP_PASSWORD=');
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(
        setItem.mock.calls.filter(([key]) => String(key).toLowerCase().includes('self')),
      ).toEqual([]);
      for (const [, value] of setItem.mock.calls) {
        expect(String(value)).not.toMatch(/DB_APP_PASSWORD|[A-Za-z0-9]{32}/);
      }
    } finally {
      vi.unstubAllGlobals();
      Reflect.deleteProperty(navigator, 'clipboard');
    }
  });
});

describe.each([
  ['light', 'en'],
  ['dark', 'en'],
  ['light', 'pt-BR'],
  ['dark', 'pt-BR'],
] as const)('the self-host page in the %s scheme, %s', (scheme, locale) => {
  it('has no accessibility violations', async () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, scheme);
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    const { container } = renderPage();
    await screen.findByRole('heading', { level: 1 });
    fireEvent.click(screen.getAllByRole('switch')[1]);
    const result = await axe.run(container, {
      runOnly: ['wcag2a', 'wcag2aa'],
      rules: { 'color-contrast': { enabled: false } },
    });
    expect(result.violations.map((v) => `${v.id}: ${v.nodes[0]?.html}`)).toEqual([]);
  });
});
