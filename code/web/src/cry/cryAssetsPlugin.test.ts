import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cryModelProblem, cryModelStatus, mediapipeWasmDir } from '../../cry-assets';
import { CRY_WASM_FILES } from './modelAssets';

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
