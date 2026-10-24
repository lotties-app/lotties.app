/**
 * Runtime cache of the cry monitor's files (docs/design/35-cry-engine.md section 4): the YAMNet model and the
 * MediaPipe WASM under /models/cry/ (11 MB) are never precached; the first monitor start downloads them and every
 * later start (also offline) reads them from this cache, cache-first. The cache name carries the MediaPipe version
 * and the model checksum, so an upgrade never mixes files; older cry caches are deleted on activate.
 * Only same-origin GETs with a complete 200 response that is not the SPA's index.html are stored.
 */
import { CRY_ASSET_CACHE, CRY_ASSET_CACHE_PREFIX, CRY_ASSET_DIR } from '../../cry/modelAssets';

/** True for a same-origin GET under <scope>/models/cry/. */
export function isCryAssetRequest(url: URL, method: string, origin: string, scope = '/'): boolean {
  const prefix = `${new URL(scope, origin).pathname.replace(/\/?$/, '/')}${CRY_ASSET_DIR}/`;
  return method === 'GET' && url.origin === origin && url.pathname.startsWith(prefix);
}

export interface CryCacheDeps {
  caches: Pick<CacheStorage, 'open'>;
  fetch: (request: Request) => Promise<Response>;
}

/** Cache-first: the cached copy if any, else the network (stored when it is a real file). */
export async function cryAssetResponse(request: Request, deps: CryCacheDeps): Promise<Response> {
  const cache = await deps.caches.open(CRY_ASSET_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await deps.fetch(request);
  const type = response.headers.get('content-type') ?? '';
  if (response.status === 200 && response.type === 'basic' && !type.includes('text/html')) {
    await cache.put(request, response.clone());
  }
  return response;
}

/** Deletes cry caches of other versions. */
export async function deleteOldCryCaches(
  caches: Pick<CacheStorage, 'keys' | 'delete'>,
): Promise<void> {
  const keys = await caches.keys();
  await Promise.all(
    keys
      .filter((key) => key.startsWith(CRY_ASSET_CACHE_PREFIX) && key !== CRY_ASSET_CACHE)
      .map((key) => caches.delete(key)),
  );
}
