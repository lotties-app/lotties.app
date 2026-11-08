import { ApiError, parseRetryAfter } from './ApiError';

/**
 * Dispatched on `window` when the server answers `403 consent_required`: the consent changed under a running app (a material
 * change deployed meanwhile), so the consent provider asks the server again and shows the consent screen if it must
 * (docs/design/38-consent-and-terms.md).
 */
export const CONSENT_REQUIRED_EVENT = 'lotties:consent-required';

export interface ApiClientOptions {
  baseUrl: string;
  /** Awaited before every request (it waits for a pending token renewal; its errors propagate). */
  getAccessToken: () => Promise<string | null>;
  /**
   * Forces a token renewal after a 401; the request is then retried once with the new token.
   * Its errors (renewal pending, session ended) propagate instead of the 401.
   */
  renewAccessToken?: () => Promise<string | null>;
  /** Called on a 401 response that a renewal did not fix, unless the request opts out. */
  onUnauthorized?: () => void;
  fetchImpl?: typeof fetch;
}

export interface RequestOptions {
  method?: string;
  body?: unknown;
  /** Extra request headers (e.g. `If-None-Match`); a `304` answer then resolves with an empty body. */
  headers?: Record<string, string>;
  signal?: AbortSignal;
  /** A body sent as it is (a file) instead of JSON; give its `contentType` with it. */
  rawBody?: Blob;
  contentType?: string;
  /** Resolve with the answer as a `Blob` (a file download) instead of parsing it as JSON. */
  responseType?: 'blob';
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
  const { baseUrl, getAccessToken, renewAccessToken, onUnauthorized } = options;

  function send(
    token: string | null,
    { method = 'GET', body, rawBody, contentType, signal, headers: extraHeaders }: RequestOptions,
    path: string,
  ) {
    const headers: Record<string, string> = { Accept: 'application/json', ...extraHeaders };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (rawBody !== undefined) headers['Content-Type'] = contentType ?? 'application/octet-stream';
    else if (body !== undefined) headers['Content-Type'] = 'application/json';
    const doFetch = options.fetchImpl ?? fetch;
    return doFetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: rawBody ?? (body === undefined ? undefined : JSON.stringify(body)),
      signal,
    });
  }

  async function requestWithMeta<T>(
    path: string,
    requestOptions: RequestOptions = {},
  ): Promise<ApiResponse<T>> {
    let response = await send(await getAccessToken(), requestOptions, path);
    // The token may expire in flight or be refused for clock skew: renew once and retry.
    if (response.status === 401 && renewAccessToken) {
      const renewed = await renewAccessToken();
      if (renewed) response = await send(renewed, requestOptions, path);
    }

    if (requestOptions.responseType === 'blob' && response.ok) {
      const file = await response.blob();
      return { data: file as T, status: response.status, headers: response.headers };
    }

    const payload = await parseBody(response);
    // A 304 only answers a conditional request the caller made itself: "your copy is current".
    if (!response.ok && response.status !== 304) {
      if (response.status === 401 && !requestOptions.skipUnauthorizedHandler) onUnauthorized?.();
      const error = new ApiError(
        response.status,
        payload,
        undefined,
        parseRetryAfter(response.headers.get('Retry-After')),
      );
      if (response.status === 403 && error.code === 'consent_required') {
        window.dispatchEvent(new Event(CONSENT_REQUIRED_EVENT));
      }
      throw error;
    }
    return { data: payload as T, status: response.status, headers: response.headers };
  }

  async function request<T>(path: string, requestOptions?: RequestOptions): Promise<T> {
    return (await requestWithMeta<T>(path, requestOptions)).data;
  }

  return { request, requestWithMeta };
}
