import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CRY_ASSET_CACHE,
  CRY_ASSET_CACHE_PREFIX,
  CRY_MODEL_BYTES,
  CRY_MODEL_SHA256,
  CRY_MODEL_URL,
  cryAssetUrls,
  MEDIAPIPE_AUDIO_VERSION,
} from './modelAssets';
import { CRY_SAFE_BAND, CRY_SENSITIVITY_THRESHOLDS, cryTriggerConfig } from './sensitivity';
import { DEFAULT_CRY_TRIGGER } from './trigger';

const WEB = path.resolve(__dirname, '..', '..');
const read = (file: string) => readFileSync(path.join(WEB, file), 'utf8');

describe('cry model assets', () => {
  it('pins the same model in the app, the fetch script and the spike harness', () => {
    const script = read('scripts/fetch-cry-model.mjs');
    expect(script).toContain(`'${CRY_MODEL_SHA256}'`);
    expect(script).toContain(`'${CRY_MODEL_URL}'`);
    expect(script).toContain(String(CRY_MODEL_BYTES));
    const spike = readFileSync(
      path.join(WEB, '..', '..', 'ml/cry_detector/cry_detector/sources.py'),
      'utf8',
    );
    expect(spike).toContain(CRY_MODEL_SHA256);
    expect(spike).toContain(CRY_MODEL_URL);
  });

  it('serves the WASM of the installed @mediapipe/tasks-audio version', () => {
    const pkg = JSON.parse(read('package.json')) as { dependencies: Record<string, string> };
    expect(pkg.dependencies['@mediapipe/tasks-audio']).toBe(MEDIAPIPE_AUDIO_VERSION);
    expect(CRY_ASSET_CACHE).toBe(
      `${CRY_ASSET_CACHE_PREFIX}mp${MEDIAPIPE_AUDIO_VERSION}-${CRY_MODEL_SHA256.slice(0, 8)}`,
    );
  });

  it('builds same-origin URLs under the app base', () => {
    expect(cryAssetUrls('https://lotties.app/')).toEqual({
      model: 'https://lotties.app/models/cry/yamnet.tflite',
      wasmLoader: 'https://lotties.app/models/cry/wasm/audio_wasm_module_internal.js',
      wasmBinary: 'https://lotties.app/models/cry/wasm/audio_wasm_module_internal.wasm',
    });
    expect(cryAssetUrls('https://example.test/app/').model).toBe(
      'https://example.test/app/models/cry/yamnet.tflite',
    );
  });
});

describe('sensitivity levels', () => {
  it('keeps every level inside the spike safe band, ordered, Balanced = the spike default', () => {
    const { less, balanced, more } = CRY_SENSITIVITY_THRESHOLDS;
    for (const t of [less, balanced, more]) {
      expect(t).toBeGreaterThanOrEqual(CRY_SAFE_BAND.min);
      expect(t).toBeLessThanOrEqual(CRY_SAFE_BAND.max);
    }
    expect(more).toBeLessThan(balanced);
    expect(balanced).toBeLessThan(less);
    expect(cryTriggerConfig()).toEqual(DEFAULT_CRY_TRIGGER);
  });

  it('moves the threshold only', () => {
    expect(cryTriggerConfig('more')).toEqual({ ...DEFAULT_CRY_TRIGGER, threshold: 0.01 });
    expect(cryTriggerConfig('less')).toEqual({ ...DEFAULT_CRY_TRIGGER, threshold: 0.03 });
  });
});
