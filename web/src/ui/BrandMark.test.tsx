import { render, screen } from '@testing-library/react';
import axe from 'axe-core';
import { describe, expect, it } from 'vitest';
import LandingPage from '../landing/LandingPage';
import { SetupMessage } from '../config/SetupMessage';
import { AuthTestWrapper } from '../test/AuthTestWrapper';
import { fakeAuth } from '../test/fakeAuth';
import { renderUi } from '../test/renderUi';
import { I18nProvider } from '../i18n/I18nProvider';
import { AppThemeProvider } from '../theme/AppThemeProvider';
import { BrandMark } from './BrandMark';

async function violations(container: HTMLElement) {
  const result = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
  return result.violations.map((v) => v.id);
}

describe('BrandMark', () => {
  it('is an image named Baby Routine when alone', async () => {
    const { container } = renderUi(<BrandMark />);
    expect(screen.getByRole('img', { name: 'Baby Routine' })).toBeTruthy();
    expect(await violations(container)).toEqual([]);
  });

  it('uses the simplified drawing up to 32 px and the full art above', () => {
    const { container } = renderUi(
      <>
        <BrandMark size={24} />
        <BrandMark size={32} />
        <BrandMark size={88} />
      </>,
    );
    const kinds = [...container.querySelectorAll('[data-brand-mark]')].map((n) =>
      n.getAttribute('data-brand-mark'),
    );
    expect(kinds).toEqual(['simple', 'simple', 'full']);
  });

  it('hides the icon when the name is shown, so the name is announced once', async () => {
    const { container } = renderUi(<BrandMark showName />);
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getAllByText('Baby Routine')).toHaveLength(1);
    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(await violations(container)).toEqual([]);
  });

  it('gives every instance its own mask ids', () => {
    const { container } = renderUi(
      <>
        <BrandMark />
        <BrandMark />
      </>,
    );
    const ids = [...container.querySelectorAll('[id]')].map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('BrandMark on the landing and setup screens', () => {
  it('landing shows the wordmark once in the header and the big mark as decoration', async () => {
    const { container } = render(
      <I18nProvider>
        <AppThemeProvider>
          <AuthTestWrapper auth={fakeAuth({ isAuthenticated: false, user: null })}>
            <LandingPage />
          </AuthTestWrapper>
        </AppThemeProvider>
      </I18nProvider>,
    );
    expect(await screen.findByRole('heading', { level: 1 })).toBeTruthy();
    expect(screen.getAllByText('Baby Routine')).toHaveLength(1);
    expect(screen.queryByRole('img', { name: 'Baby Routine' })).toBeNull();
    expect(container.querySelector('[data-brand-mark="full"]')).not.toBeNull();
    expect(await violations(container)).toEqual([]);
  });

  it('setup message shows the wordmark once above its heading', async () => {
    const { container } = renderUi(<SetupMessage missing={['VITE_OIDC_AUTHORITY']} />);
    expect(screen.getAllByText('Baby Routine')).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 })).toBeTruthy();
    expect(await violations(container)).toEqual([]);
  });
});
