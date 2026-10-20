import type { ReactNode } from 'react';
import { createApiClient } from './apiClient';
import { ApiClientContext } from './ApiClientContext';
import { useAuth } from '../auth/useAuth';

export function ApiClientProvider({ baseUrl, children }: { baseUrl: string; children: ReactNode }) {
  const { getAccessToken, login } = useAuth();
  const client = createApiClient({
    baseUrl,
    getAccessToken,
    onUnauthorized: () => void login(window.location.pathname + window.location.search),
  });
  return <ApiClientContext value={client}>{children}</ApiClientContext>;
}
