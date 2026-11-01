/**
 * Where the cry engine's files live (docs/design/35-cry-engine.md section 4). Self-hosted next to the app, never a
 * third-party CDN: `yamnet.tflite` is downloaded at image build time by scripts/fetch-cry-model.mjs (pinned SHA-256,
 * never committed) into public/models/cry/; the MediaPipe WASM is copied from the npm package by the Vite plugin in
 * cry-assets.ts. The service worker caches both at run time (cache-first, src/pwa/sw/cryAssets.ts), never precaches.
 *
 * Imported by the app, the service worker and the build plugin: keep it free of DOM or Node APIs.
 */

/** @mediapipe/tasks-audio version whose WASM is served (package.json pins it exactly). */
export const MEDIAPIPE_AUDIO_VERSION = '1.1.1';

/** YAMNet float32 from MediaPipe's model storage (the spike's file, docs/design/31 section 1). */
export const CRY_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/audio_classifier/yamnet/float32/1/yamnet.tflite';
export const CRY_MODEL_SHA256 = '4d8b4a53282dc83ef04e3e7dbc4fbc98082e34e44ed798e16c3a0cdd4c584faf';
export const CRY_MODEL_BYTES = 4_126_810;

/** Published paths, relative to the app's base URL. */
export const CRY_ASSET_DIR = 'models/cry';
export const CRY_MODEL_FILE = 'yamnet.tflite';
/** The ES-module build of the MediaPipe audio WASM (SIMD), loaded from a module worker. */
export const CRY_WASM_FILES = Object.freeze({
  loader: 'audio_wasm_module_internal.js',
  binary: 'audio_wasm_module_internal.wasm',
});
export const CRY_WASM_DIR = `${CRY_ASSET_DIR}/wasm`;

/** Runtime cache of the service worker; the name changes with the files, so an upgrade never mixes versions. */
export const CRY_ASSET_CACHE_PREFIX = 'lotties-cry-assets-';
export const CRY_ASSET_CACHE = `${CRY_ASSET_CACHE_PREFIX}mp${MEDIAPIPE_AUDIO_VERSION}-${CRY_MODEL_SHA256.slice(0, 8)}`;

export interface CryAssetUrls {
  model: string;
  wasmLoader: string;
  wasmBinary: string;
}

/** Absolute URLs of the files for an app base URL (e.g. `new URL(import.meta.env.BASE_URL, location.origin)`). */
export function cryAssetUrls(base: string | URL): CryAssetUrls {
  const at = (path: string) => new URL(path, base).toString();
  return {
    model: at(`${CRY_ASSET_DIR}/${CRY_MODEL_FILE}`),
    wasmLoader: at(`${CRY_WASM_DIR}/${CRY_WASM_FILES.loader}`),
    wasmBinary: at(`${CRY_WASM_DIR}/${CRY_WASM_FILES.binary}`),
  };
}
