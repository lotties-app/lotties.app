import { vi } from 'vitest';
import type { AuthApi } from '../auth/AuthContext';

export function fakeAuth(overrides: Partial<AuthApi> = {}): AuthApi {
  return {
    user: { name: 'Ana' },
    accountId: overrides.isAuthenticated === false ? null : 'https://issuer.test|user-1',
    isAuthenticated: true,
    isLoading: false,
    error: null,
    login: vi.fn(async () => {}),
    logout: vi.fn(async () => {}),
    getAccessToken: async () => 'token',
    ...overrides,
  };
}
