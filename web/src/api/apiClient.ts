import { ApiError } from './ApiError';

export interface ApiClientOptions {
  baseUrl: string;
  getAccessToken: () => Promise<string | null>;
  /** Called on a 401 response (e.g. to trigger re-login). */
  onUnauthorized?: () => void;
  fetchImpl?: typeof fetch;
}

export interface RequestOptions {
  method?: string;
  body?: unknown;
  signal?: AbortSignal;
}

export interface ApiClient {
  request: <T>(path: string, options?: RequestOptions) => Promise<T>;
}

async function parseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export function createApiClient(options: ApiClientOptions): ApiClient {
  const { baseUrl, getAccessToken, onUnauthorized } = options;

  async function request<T>(path: string, { method = 'GET', body, signal }: RequestOptions = {}) {
    const headers: Record<string, string> = { Accept: 'application/json' };
    const token = await getAccessToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    const doFetch = options.fetchImpl ?? fetch;
    const response = await doFetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });

    const payload = await parseBody(response);
    if (!response.ok) {
      if (response.status === 401) onUnauthorized?.();
      throw new ApiError(response.status, payload);
    }
    return payload as T;
  }

  return { request };
}
