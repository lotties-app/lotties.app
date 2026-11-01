export interface BuildInfo {
  /** `version` of code/web/package.json at build time. */
  version: string;
  /** ISO time the bundle was built (the deploy builds it, so this is the deploy's build). */
  builtAt: string;
  /** Short commit, empty when the build had no git checkout and no `APP_COMMIT`. */
  commit: string;
}

/**
 * What this bundle is: stamped by Vite's `define` (vite.config.ts) when it is built. The constants
 * are guarded so a tool that does not run through Vite (a script, a bare type check) gets a
 * placeholder instead of a ReferenceError.
 */
export function readBuildInfo(): BuildInfo {
  return {
    version: typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0',
    builtAt: typeof __APP_BUILT_AT__ === 'string' ? __APP_BUILT_AT__ : '',
    commit: typeof __APP_COMMIT__ === 'string' ? __APP_COMMIT__ : '',
  };
}
