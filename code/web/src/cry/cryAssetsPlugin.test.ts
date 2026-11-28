import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ResolvedConfig } from 'vite';
import {
  cryAssetsPlugin,
  cryModelProblem,
  cryModelStatus,
  mediapipeWasmDir,
} from '../../cry-assets';
import { CRY_ASSET_DIR, CRY_WASM_DIR, CRY_WASM_FILES } from './modelAssets';

/* The build plugin's checks (cry-assets.ts): where the WASM comes from, and the model's state. */

const WEB = path.resolve(__dirname, '..', '..');
let dir: string | null = null;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = null;
});

describe('cry assets build plugin', () => {
  it('takes the WASM from the installed @mediapipe/tasks-audio package', () => {
    const wasm = mediapipeWasmDir(WEB);
    for (const name of Object.values(CRY_WASM_FILES)) {
      expect(existsSync(path.join(wasm, name))).toBe(true);
    }
  });

  it('reports a missing or different model, never fails without CRY_MODEL_REQUIRED', () => {
    dir = mkdtempSync(path.join(tmpdir(), 'cry-public-'));
    expect(cryModelStatus(dir)).toBe('missing');
    expect(cryModelProblem('missing')).toMatch(/is missing.*model_missing.*fetch-cry-model/);
    mkdirSync(path.join(dir, 'models', 'cry'), { recursive: true });
    writeFileSync(path.join(dir, 'models', 'cry', 'yamnet.tflite'), 'not the model');
    expect(cryModelStatus(dir)).toBe('different');
    expect(cryModelProblem('different')).toMatch(/model_invalid/);
    expect(cryModelProblem('ok')).toBeNull();
  });
});

/** Runs the plugin's output step on a temporary build with these build values; the messages it gave. */
async function buildWith(env: Record<string, string>, mode = 'production') {
  dir = mkdtempSync(path.join(tmpdir(), 'cry-build-'));
  const outDir = path.join(dir, 'dist');
  // A model left in public/ is copied into the output by Vite before the plugin runs.
  mkdirSync(path.join(outDir, CRY_ASSET_DIR), { recursive: true });
  writeFileSync(path.join(outDir, CRY_ASSET_DIR, 'yamnet.tflite'), 'copied from public');
  const plugin = cryAssetsPlugin({ CRY_MODEL_REQUIRED: '1' });
  const config = {
    root: WEB,
    build: { outDir },
    publicDir: path.join(dir, 'public'),
    base: '/',
    mode,
    env,
  } as unknown as ResolvedConfig;
  (plugin.configResolved as (config: ResolvedConfig) => void)(config);
  const errors: string[] = [];
  const warnings: string[] = [];
  const context = {
    error: (message: string) => errors.push(message),
    warn: (message: string) => warnings.push(message),
  };
  const writeBundle = plugin.writeBundle as unknown as {
    handler: (this: typeof context) => Promise<void>;
  };
  await writeBundle.handler.call(context);
  return { outDir, errors, warnings };
}

describe('cry assets build plugin and the cry monitor switch', () => {
  it('ships no model or WASM and checks nothing while the monitor is switched off', async () => {
    const { outDir, errors, warnings } = await buildWith({});
    expect(existsSync(path.join(outDir, CRY_ASSET_DIR))).toBe(false);
    expect(existsSync(path.join(outDir, CRY_WASM_DIR))).toBe(false);
    // CRY_MODEL_REQUIRED=1 (the Dockerfile) does not fail a build that ships no monitor.
    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it('copies the WASM and checks the model when VITE_CRY_MONITOR is true', async () => {
    const { outDir, errors } = await buildWith({ VITE_CRY_MONITOR: 'true' });
    for (const name of Object.values(CRY_WASM_FILES)) {
      expect(existsSync(path.join(outDir, CRY_WASM_DIR, name))).toBe(true);
    }
    // The fake model is not the pinned file: a required model fails the build.
    expect(errors).toEqual([expect.stringMatching(/model_missing|model_invalid/)]);
  });

  it('ships nothing in the native build, even with the monitor switched on', async () => {
    const { outDir, errors } = await buildWith({ VITE_CRY_MONITOR: 'true' }, 'native');
    expect(existsSync(path.join(outDir, CRY_ASSET_DIR))).toBe(false);
    expect(errors).toEqual([]);
  });
});
