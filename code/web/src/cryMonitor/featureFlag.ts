/*
 * The cry monitor's switch (docs/design/35-cry-engine.md section 9): off unless the build sets
 * VITE_CRY_MONITOR=true. Off, the Hub has no entry, /hub/cry-monitor goes to the Hub, the settings show no
 * "Cry detected" alert, the web build ships no model or WASM and the service worker drops their cache.
 * Spells the monitor already recorded stay ordinary fussy events (timeline, export, backup, erasure).
 * Shared by the app, the service worker (src/pwa/sw/sw.ts) and the build plugin (cry-assets.ts).
 */

/** The build-time variable that turns the cry monitor on. */
export const CRY_MONITOR_FLAG = 'VITE_CRY_MONITOR';

/** Whether these build values turn the cry monitor on (only the exact value `true`). */
export function cryMonitorFlagOn(env: Readonly<Record<string, unknown>>): boolean {
  return env[CRY_MONITOR_FLAG] === 'true';
}

/** Whether this build has the cry monitor on. */
export function cryMonitorEnabled(): boolean {
  return import.meta.env.VITE_CRY_MONITOR === 'true';
}
