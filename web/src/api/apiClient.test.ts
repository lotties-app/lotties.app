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
});
