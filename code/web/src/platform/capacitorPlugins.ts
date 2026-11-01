// The Capacitor plugins of the native shell, in one module so they share one lazy chunk. Import it
// only dynamically (platform/nativeShell.ts): a static import would put @capacitor/* in the PWA.
export { App } from '@capacitor/app';
export { Browser } from '@capacitor/browser';
export { SystemBars, SystemBarsStyle } from '@capacitor/core';
