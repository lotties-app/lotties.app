/** The part of the global the Capacitor native bridge injects that this check reads. */
interface CapacitorBridge {
  isNativePlatform?: () => boolean;
}

/**
 * True inside the Lotties iOS/Android app (the Capacitor shell in code/mobile), false in every
 * browser, installed PWA included. It is `Capacitor.isNativePlatform()` read from the bridge the
 * shell injects before any page script runs, so the PWA bundle never loads @capacitor/core: all
 * native code sits behind this check and is imported lazily (platform/nativeShell.ts).
 */
export function isNativeApp(
  scope: { Capacitor?: CapacitorBridge } = globalThis as { Capacitor?: CapacitorBridge },
): boolean {
  try {
    return scope.Capacitor?.isNativePlatform?.() === true;
  } catch {
    return false;
  }
}

/** The part of the bridge global `nativePlatform` reads. */
interface CapacitorPlatformBridge extends CapacitorBridge {
  getPlatform?: () => string;
}

/**
 * 'ios' or 'android' inside the Lotties app (`Capacitor.getPlatform()` of the injected bridge, no
 * @capacitor/core import), null in every browser. The voice connection differs per platform (Siri
 * on iOS, Voice on Android: assistants/siriBridge.ts).
 */
export function nativePlatform(
  scope: { Capacitor?: CapacitorPlatformBridge } = globalThis as {
    Capacitor?: CapacitorPlatformBridge;
  },
): 'ios' | 'android' | null {
  if (!isNativeApp(scope)) return null;
  try {
    const platform = scope.Capacitor?.getPlatform?.();
    return platform === 'ios' || platform === 'android' ? platform : null;
  } catch {
    return null;
  }
}
