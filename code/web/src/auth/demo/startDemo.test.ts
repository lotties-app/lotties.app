import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readDemoSession } from './demoSession';
import { StartDemoError, fetchDemoInfo, startDemo } from './startDemo';

const jwt = `h.${btoa(JSON.stringify({ sub: 'demo-1' }))}.s`;

function respond(status: number, body?: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(body === undefined ? null : JSON.stringify(body), { status })),
  );
}

describe('startDemo', () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => vi.unstubAllGlobals());

  it('stores the session and loads the app', async () => {
    respond(200, { accessToken: jwt, expiresAt: '2999-01-01T00:00:00Z', lifetimeDays: 3 });
    const navigate = vi.fn();
    await startDemo('pt-BR', { base: 'http://api', navigate });
    expect(navigate).toHaveBeenCalledWith('/');
    expect(readDemoSession()?.sub).toBe('demo-1');
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe('http://api/api/v1/demo/start');
    expect(JSON.parse(String(init?.body))).toEqual({ locale: 'pt-BR' });
  });

  it.each([
    [503, 'capacity'],
    [429, 'rateLimited'],
    [500, 'unavailable'],
    [404, 'unavailable'],
  ])('maps %i to %s and stores nothing', async (status, reason) => {
    respond(status);
    await expect(startDemo('en', { navigate: vi.fn() })).rejects.toMatchObject({ reason });
    expect(readDemoSession()).toBeNull();
  });

  it('reports offline and a malformed answer', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('network');
      }),
    );
    await expect(startDemo('en')).rejects.toEqual(new StartDemoError('offline'));
    respond(200, { accessToken: 'garbage', expiresAt: '2999-01-01T00:00:00Z' });
    await expect(startDemo('en')).rejects.toMatchObject({ reason: 'unavailable' });
  });

  it('reads the offer, and null when it is not there', async () => {
    respond(200, { enabled: true, lifetimeDays: 3 });
    expect(await fetchDemoInfo('')).toEqual({ enabled: true, lifetimeDays: 3 });
    respond(404);
    expect(await fetchDemoInfo('')).toBeNull();
  });
});
