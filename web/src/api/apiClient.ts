import { ApiError } from './ApiError';

export interface ApiClientOptions {
  baseUrl: string;
  getAccessToken: () => Promise<string | null>;
  /** Called on a 401 response (e.g. to trigger re-login), unless the request opts out. */
  onUnauthorized?: () => void;
  fetchImpl?: typeof fetch;
}

export interface RequestOptions {
  method?: string;
  body?: unknown;
  signal?: AbortSignal;
  /**
   * Skip `onUnauthorized` on a 401 (the `ApiError` is still thrown). Background work such as sync
   * sets this so it can pause itself instead of navigating away to the login page.
   */
  skipUnauthorizedHandler?: boolean;
}

/** A parsed response body together with its status and headers. */
export interface ApiResponse<T> {
  data: T;
  status: number;
  headers: Headers;
}

export interface ApiClient {
  /** Resolves with the parsed body; throws `ApiError` for non-2xx responses. */
  request: <T>(path: string, options?: RequestOptions) => Promise<T>;
  /** Like `request`, but also exposes the status and response headers (e.g. paging cursors). */
  requestWithMeta: <T>(path: string, options?: RequestOptions) => Promise<ApiResponse<T>>;
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

  async function requestWithMeta<T>(
    path: string,
    { method = 'GET', body, signal, skipUnauthorizedHandler = false }: RequestOptions = {},
  ): Promise<ApiResponse<T>> {
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
      if (response.status === 401 && !skipUnauthorizedHandler) onUnauthorized?.();
      throw new ApiError(response.status, payload);
    }
    return { data: payload as T, status: response.status, headers: response.headers };
  }

  async function request<T>(path: string, requestOptions?: RequestOptions): Promise<T> {
    return (await requestWithMeta<T>(path, requestOptions)).data;
  }

  return { request, requestWithMeta };
}
