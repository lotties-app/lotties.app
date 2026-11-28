import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  hasCurrentConsent,
  readSensitivity,
  writeConsent,
  writeSensitivity,
} from './monitorStorage';
import { clearCryConsentWhileSwitchedOff } from './switchedOff';

/* The start-up clean-up while the cry monitor is switched off (docs/design/35-cry-engine.md section 9). */

beforeEach(() => {
  window.localStorage.clear();
  writeConsent();
  writeSensitivity('more');
});

afterEach(() => {
  vi.unstubAllEnvs();
  window.localStorage.clear();
});

describe('clearCryConsentWhileSwitchedOff', () => {
  it('removes this device consent while the monitor is switched off (the default)', () => {
    expect(hasCurrentConsent()).toBe(true);
    clearCryConsentWhileSwitchedOff();
    expect(hasCurrentConsent()).toBe(false);
    // The sensitivity is a device preference, not a consent: it stays.
    expect(readSensitivity()).toBe('more');
  });

  it('keeps the consent untouched when the build switches the monitor on', () => {
    vi.stubEnv('VITE_CRY_MONITOR', 'true');
    clearCryConsentWhileSwitchedOff();
    expect(hasCurrentConsent()).toBe(true);
    expect(readSensitivity()).toBe('more');
  });

  it('follows an explicit answer, whatever the build says', () => {
    clearCryConsentWhileSwitchedOff(true);
    expect(hasCurrentConsent()).toBe(true);
    vi.stubEnv('VITE_CRY_MONITOR', 'true');
    clearCryConsentWhileSwitchedOff(false);
    expect(hasCurrentConsent()).toBe(false);
  });

  it('runs once at app start, before the app renders', () => {
    const main = readFileSync(path.resolve(__dirname, '..', 'main.tsx'), 'utf8');
    const call = main.indexOf('clearCryConsentWhileSwitchedOff();');
    expect(call).toBeGreaterThan(-1);
    expect(call).toBeLessThan(main.indexOf('createRoot('));
  });
});
