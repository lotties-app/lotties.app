/**
 * Build wiring of the cry monitor's runtime files (docs/design/35-cry-engine.md section 4):
 *  - the MediaPipe audio WASM (ES-module build) is copied from the installed @mediapipe/tasks-audio package to
 *    dist/models/cry/wasm/ and served from node_modules by the dev server, so it is never fetched from a CDN;
 *  - the YAMNet model (public/models/cry/yamnet.tflite, from scripts/fetch-cry-model.mjs) is only checked: a missing
 *    or different file is a warning (monitor mode then fails with `model_missing` / `model_invalid`), and an error
 *    when CRY_MODEL_REQUIRED=1 (the web Dockerfile sets it).
 * Neither file is precached by the service worker (vite.config.ts globIgnores; runtime cache in src/pwa/sw).
 * The native build (Vite mode `native`) ships neither: monitor mode in the iOS/Android shell is a later, separate
 * decision (docs/design/31 CD10) that also needs the microphone permissions and 'wasm-unsafe-eval' in native-csp.ts.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { copyFile, mkdir, rm, rmdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { Plugin } from 'vite';
import {
  CRY_ASSET_DIR,
  CRY_MODEL_FILE,
  CRY_MODEL_SHA256,
  CRY_WASM_DIR,
  CRY_WASM_FILES,
} from './src/cry/modelAssets';
import { NATIVE_MODE } from './native-csp';

export const CRY_MODEL_REQUIRED_ENV = 'CRY_MODEL_REQUIRED';

const CONTENT_TYPES: Record<string, string> = {
  '.js': 'text/javascript',
  '.wasm': 'application/wasm',
};

/** Folder of the installed package's WASM files (resolved through the package's own exports map). */
export function mediapipeWasmDir(root: string): string {
  const require = createRequire(path.join(root, 'package.json'));
  return path.dirname(require.resolve(`@mediapipe/tasks-audio/${CRY_WASM_FILES.loader}`));
}

export type CryModelStatus = 'ok' | 'missing' | 'different';

/** Whether public/models/cry/yamnet.tflite is the pinned model. */
export function cryModelStatus(publicDir: string): CryModelStatus {
  let bytes: Buffer;
  try {
    bytes = readFileSync(path.join(publicDir, CRY_ASSET_DIR, CRY_MODEL_FILE));
  } catch {
    return 'missing';
  }
  return createHash('sha256').update(bytes).digest('hex') === CRY_MODEL_SHA256 ? 'ok' : 'different';
}

/** The message for a model that is not ready, or null. */
export function cryModelProblem(status: CryModelStatus): string | null {
  if (status === 'ok') return null;
  const what = status === 'missing' ? 'is missing' : 'is not the pinned file (checksum)';
  return (
    `public/${CRY_ASSET_DIR}/${CRY_MODEL_FILE} ${what}: the cry monitor will report ` +
    `${status === 'missing' ? 'model_missing' : 'model_invalid'}. Run node scripts/fetch-cry-model.mjs.`
  );
}

export function cryAssetsPlugin(env: Record<string, string | undefined> = process.env): Plugin {
  let root = process.cwd();
  let outDir = 'dist';
  let publicDir = 'public';
  let base = '/';
  let native = false;
  return {
    name: 'baby-routine:cry-assets',
    configResolved(config) {
      root = config.root;
      outDir = path.resolve(config.root, config.build.outDir);
      publicDir = config.publicDir || path.join(config.root, 'public');
      base = config.base || '/';
      native = config.mode === NATIVE_MODE;
    },
    configureServer(server) {
      const prefix = `${base.replace(/\/?$/, '/')}${CRY_WASM_DIR}/`;
      const allowed = new Set<string>(Object.values(CRY_WASM_FILES));
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? '').split('?')[0];
        const name = url.startsWith(prefix) ? url.slice(prefix.length) : '';
        if (!allowed.has(name)) return next();
        try {
          const body = readFileSync(path.join(mediapipeWasmDir(root), name));
          res.setHeader('Content-Type', CONTENT_TYPES[path.extname(name)]);
          res.end(body);
        } catch (error) {
          next(error);
        }
      });
    },
    writeBundle: {
      // After Vite has copied public/ into the output.
      order: 'post',
      async handler() {
        if (native) {
          // A model fetched for local web builds is copied from public/ by Vite: keep it out of the app bundle.
          await rm(path.join(outDir, CRY_ASSET_DIR), { recursive: true, force: true });
          await rmdir(path.dirname(path.join(outDir, CRY_ASSET_DIR))).catch(() => undefined);
          return;
        }
        const source = mediapipeWasmDir(root);
        const target = path.join(outDir, CRY_WASM_DIR);
        await mkdir(target, { recursive: true });
        for (const name of Object.values(CRY_WASM_FILES)) {
          await copyFile(path.join(source, name), path.join(target, name));
        }
        const problem = cryModelProblem(cryModelStatus(publicDir));
        if (problem && env[CRY_MODEL_REQUIRED_ENV] === '1') this.error(problem);
        if (problem) this.warn(problem);
      },
    },
  };
}
