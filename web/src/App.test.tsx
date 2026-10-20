import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import App from './App';

describe('App without configuration', () => {
  it('shows the setup message and the missing variables', () => {
    render(<App configResult={{ ok: false, missing: ['VITE_OIDC_AUTHORITY'] }} />);
    expect(screen.getByRole('heading', { name: 'Setup required' })).toBeTruthy();
    expect(screen.getByText('VITE_OIDC_AUTHORITY')).toBeTruthy();
  });
});
