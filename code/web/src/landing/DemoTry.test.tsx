import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../i18n/I18nProvider';
import { AuthTestWrapper } from '../test/AuthTestWrapper';
import { fakeAuth } from '../test/fakeAuth';
import { DemoTry } from './DemoTry';

function offer(body: unknown, status = 200) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      url.endsWith('/demo/start')
        ? new Response(null, { status: 503 })
        : new Response(JSON.stringify(body), { status }),
    ),
  );
}

const renderTry = () =>
  render(
    <I18nProvider>
      <AuthTestWrapper auth={fakeAuth({ isAuthenticated: false })}>
        <DemoTry />
      </AuthTestWrapper>
    </I18nProvider>,
  );

describe('DemoTry', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('shows the button, the lifetime and the consent links when the server offers the demo', async () => {
    offer({ enabled: true, lifetimeDays: 3 });
    renderTry();
    expect(await screen.findByRole('button', { name: 'Try the demo' })).toBeTruthy();
    expect(screen.getByText(/deleted automatically after 3 days/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'terms' }).getAttribute('href')).toBe('/terms');
    expect(screen.getByRole('link', { name: 'privacy policy' }).getAttribute('href')).toBe(
      '/privacy',
    );
  });

  it('shows nothing when the demo is off', async () => {
    offer({ enabled: false, lifetimeDays: 3 });
    const { container } = renderTry();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(container.textContent).toBe('');
  });

  it('explains a full demo', async () => {
    offer({ enabled: true, lifetimeDays: 3 });
    renderTry();
    (await screen.findByRole('button', { name: 'Try the demo' })).click();
    expect((await screen.findByRole('alert')).textContent).toMatch(/demo is full/);
    expect(screen.getByRole('button', { name: 'Try the demo' })).toBeTruthy();
  });
});
