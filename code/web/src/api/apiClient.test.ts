import { describe, expect, it, vi } from 'vitest';
import { createApiClient } from './apiClient';
import { ApiError } from './ApiError';
import { getHealth } from './health';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

function setup(response: Response) {
  const onUnauthorized = vi.fn();
  const fetchImpl = vi.fn<typeof fetch>(async () => response);
  const client = createApiClient({
    baseUrl: 'http://api',
    getAccessToken: async () => 'tok',
    onUnauthorized,
    fetchImpl,
  });
  return { client, fetchImpl, onUnauthorized };
}

describe('apiClient', () => {
  it('sends the bearer token and parses JSON', async () => {
    const { client, fetchImpl } = setup(jsonResponse({ status: 'ok' }));
    await expect(getHealth(client)).resolves.toEqual({ status: 'ok' });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://api/health');
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer tok');
  });

  it('serializes JSON bodies', async () => {
    const { client, fetchImpl } = setup(jsonResponse({}));
    await client.request('/x', { method: 'POST', body: { a: 1 } });
    const [, init] = fetchImpl.mock.calls[0];
    expect(init?.body).toBe('{"a":1}');
    expect((init?.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });

  it('maps error responses to ApiError', async () => {
    const { client, onUnauthorized } = setup(jsonResponse({ title: 'bad' }, 400));
    const error = await client.request('/x').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(400);
    expect((error as ApiError).body).toEqual({ title: 'bad' });
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('triggers re-login on 401', async () => {
    const { client, onUnauthorized } = setup(jsonResponse({}, 401));
    await expect(client.request('/x')).rejects.toMatchObject({ status: 401 });
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });

  it('skips the 401 handler when the request opts out', async () => {
    const { client, onUnauthorized } = setup(jsonResponse({}, 401));
    await expect(client.request('/x', { skipUnauthorizedHandler: true })).rejects.toMatchObject({
      status: 401,
    });
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('exposes status and headers through requestWithMeta', async () => {
    const response = new Response('[1]', { status: 200, headers: { 'X-Next-Cursor': 'abc' } });
    const { client } = setup(response);
    const result = await client.requestWithMeta<number[]>('/x');
    expect(result.data).toEqual([1]);
    expect(result.status).toBe(200);
    expect(result.headers.get('x-next-cursor')).toBe('abc');
  });

  it('exposes the problem details code on ApiError', async () => {
    const { client } = setup(jsonResponse({ title: 'Conflict', code: 'event_baby_mismatch' }, 409));
    const error = (await client.request('/x').catch((e: unknown) => e)) as ApiError;
    expect(error.code).toBe('event_baby_mismatch');
    expect(error.problem?.title).toBe('Conflict');
  });
});

describe('apiClient token renewal (B1)', () => {
  it('awaits the token getter before sending (a pending renewal)', async () => {
    let release!: (token: string) => void;
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({}));
    const client = createApiClient({
      baseUrl: 'http://api',
      getAccessToken: () => new Promise((resolve) => (release = resolve)),
      fetchImpl,
    });
    const request = client.request('/x');
    await Promise.resolve();
    expect(fetchImpl).not.toHaveBeenCalled();
    release('renewed');
    await request;
    expect((fetchImpl.mock.calls[0][1]?.headers as Record<string, string>).Authorization).toBe(
      'Bearer renewed',
    );
  });

  it('renews once after a 401 and retries with the new token', async () => {
    const onUnauthorized = vi.fn();
    const renewAccessToken = vi.fn(async () => 'fresh');
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({}, 401))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    const client = createApiClient({
      baseUrl: 'http://api',
      getAccessToken: async () => 'stale',
      renewAccessToken,
      onUnauthorized,
      fetchImpl,
    });

    await expect(client.request('/x')).resolves.toEqual({ ok: true });

    expect(renewAccessToken).toHaveBeenCalledOnce();
    const auth = fetchImpl.mock.calls.map(
      ([, init]) => (init?.headers as Record<string, string>).Authorization,
    );
    expect(auth).toEqual(['Bearer stale', 'Bearer fresh']);
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('retries only once: a second 401 reaches the unauthorized handler', async () => {
    const onUnauthorized = vi.fn();
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({}, 401));
    const client = createApiClient({
      baseUrl: 'http://api',
      getAccessToken: async () => 'stale',
      renewAccessToken: async () => 'fresh',
      onUnauthorized,
      fetchImpl,
    });

    await expect(client.request('/x')).rejects.toMatchObject({ status: 401 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });

  it('propagates a renewal that cannot complete (offline) instead of the 401', async () => {
    const pending = Object.assign(new Error('pending'), { name: 'TokenRenewalPendingError' });
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({}, 401));
    const client = createApiClient({
      baseUrl: 'http://api',
      getAccessToken: async () => 'stale',
      renewAccessToken: async () => {
        throw pending;
      },
      fetchImpl,
    });
    await expect(client.request('/x')).rejects.toBe(pending);
  });
});
