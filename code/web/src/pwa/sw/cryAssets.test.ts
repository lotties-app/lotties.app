import { describe, expect, it, vi } from 'vitest';
import { CRY_ASSET_CACHE } from '../../cry/modelAssets';
import { cryAssetResponse, deleteOldCryCaches, isCryAssetRequest } from './cryAssets';

/* The service worker's runtime cache for the cry monitor's model and WASM (never precached). */

const ORIGIN = 'https://lotties.app';

class FakeCache {
  store = new Map<string, Response>();
  async match(request: Request) {
    return this.store.get(request.url)?.clone();
  }
  async put(request: Request, response: Response) {
    this.store.set(request.url, response);
  }
}

function setup(network: () => Response) {
  const cache = new FakeCache();
  const opened: string[] = [];
  const caches = {
    open: async (name: string) => {
      opened.push(name);
      return cache as unknown as Cache;
    },
  };
  const fetch = vi.fn(async () => network());
  return { cache, caches, fetch, opened };
}

/** A same-origin response as the service worker sees it (`type` basic). */
const basic = (body: string, status = 200, type = 'application/wasm') => {
  const response = new Response(body, { status, headers: { 'content-type': type } });
  Object.defineProperty(response, 'type', { value: 'basic' });
  return response;
};

describe('cry asset requests', () => {
  it.each([
    ['https://lotties.app/models/cry/yamnet.tflite', 'GET', true],
    ['https://lotties.app/models/cry/wasm/audio_wasm_module_internal.wasm', 'GET', true],
    ['https://lotties.app/models/cry/yamnet.tflite', 'POST', false],
    ['https://cdn.example/models/cry/yamnet.tflite', 'GET', false],
    ['https://lotties.app/models/other.bin', 'GET', false],
    ['https://lotties.app/assets/index.js', 'GET', false],
    ['https://lotties.app/api/models/cry/x', 'GET', false],
  ])('%s %s -> %s', (url, method, expected) => {
    expect(isCryAssetRequest(new URL(url), method, ORIGIN, `${ORIGIN}/`)).toBe(expected);
  });

  it('follows a sub-path scope', () => {
    const url = new URL('https://lotties.app/app/models/cry/yamnet.tflite');
    expect(isCryAssetRequest(url, 'GET', ORIGIN, `${ORIGIN}/app/`)).toBe(true);
    expect(isCryAssetRequest(url, 'GET', ORIGIN, `${ORIGIN}/`)).toBe(false);
  });
});

describe('cache-first', () => {
  it('downloads once, then serves from the versioned cache (offline too)', async () => {
    const { caches, fetch, opened } = setup(() => basic('wasm-bytes'));
    const request = new Request(`${ORIGIN}/models/cry/wasm/audio_wasm_module_internal.wasm`);
    expect(await (await cryAssetResponse(request, { caches, fetch })).text()).toBe('wasm-bytes');
    fetch.mockRejectedValue(new TypeError('offline'));
    expect(await (await cryAssetResponse(request, { caches, fetch })).text()).toBe('wasm-bytes');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(opened).toEqual([CRY_ASSET_CACHE, CRY_ASSET_CACHE]);
  });

  it('never stores an error, a partial response or the SPA fallback page', async () => {
    for (const response of [
      () => basic('', 404),
      () => basic('part', 206),
      () => basic('<!doctype html>', 200, 'text/html'),
      () => new Response('opaque-ish', { status: 200 }),
    ]) {
      const { cache, caches, fetch } = setup(response);
      await cryAssetResponse(new Request(`${ORIGIN}/models/cry/yamnet.tflite`), { caches, fetch });
      expect(cache.store.size).toBe(0);
    }
  });

  it('deletes cry caches of other versions only', async () => {
    const keys = ['lotties-cry-assets-mp1.0.0-deadbeef', CRY_ASSET_CACHE, 'workbox-precache-v2'];
    const deleted: string[] = [];
    await deleteOldCryCaches({
      keys: async () => keys,
      delete: async (key: string) => {
        deleted.push(key);
        return true;
      },
    });
    expect(deleted).toEqual(['lotties-cry-assets-mp1.0.0-deadbeef']);
  });
});
