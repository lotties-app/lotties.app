import type { ApiClient } from './apiClient';

export interface HealthStatus {
  status: string;
}

export function getHealth(client: ApiClient, signal?: AbortSignal) {
  return client.request<HealthStatus>('/health', { signal });
}
