import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import App from './App';

// The service worker is not available in jsdom; the update prompt is tested in pwa/ReloadPrompt.test.tsx.
vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({
    needRefresh: [false, vi.fn()],
    offlineReady: [false, vi.fn()],
    updateServiceWorker: vi.fn(),
  }),
}));

describe('App without configuration', () => {
  it('shows the setup message and the missing variables', () => {
    render(<App configResult={{ ok: false, missing: ['VITE_OIDC_AUTHORITY'] }} />);
    expect(screen.getByRole('heading', { name: 'Setup required' })).toBeTruthy();
    expect(screen.getByText('VITE_OIDC_AUTHORITY')).toBeTruthy();
  });
});
