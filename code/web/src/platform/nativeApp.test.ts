import { afterEach, describe, expect, it } from 'vitest';
import { isNativeApp } from './nativeApp';
import { pretendNativeApp } from './nativeTestKit';

let undo: (() => void) | undefined;

afterEach(() => {
  undo?.();
  undo = undefined;
});

describe('isNativeApp', () => {
  it('is false in a browser (no Capacitor bridge)', () => {
    expect(isNativeApp()).toBe(false);
  });

  it('is true when the native bridge says so', () => {
    undo = pretendNativeApp();
    expect(isNativeApp()).toBe(true);
  });

  it('is false for the web build of @capacitor/core or a broken bridge', () => {
    expect(isNativeApp({ Capacitor: { isNativePlatform: () => false } })).toBe(false);
    expect(isNativeApp({ Capacitor: {} })).toBe(false);
    expect(
      isNativeApp({
        Capacitor: {
          isNativePlatform: () => {
            throw new Error('bridge not ready');
          },
        },
      }),
    ).toBe(false);
  });
});
