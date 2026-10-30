/**
 * What a build stamps into the bundle (vite.config.ts `define`, read by src/config/buildInfo.ts): the release, the
 * short commit and the build time. deploy/homelab/deploy.sh passes them as the Docker build args APP_VERSION,
 * APP_COMMIT and APP_BUILD_TIME (code/web/Dockerfile exports them as ENV); a local build has none of them and shows
 * "dev". Pure functions so the mapping is unit tested (src/config/buildDefines.test.ts).
 */

/** Shown when the build was not stamped with a release (local dev, a fixed TAG without VERSION). */
export const DEV_VERSION = 'dev';

type Env = Record<string, string | undefined>;

/** The release X.Y.Z (a leading v dropped) from `APP_VERSION`, else `dev`. */
export function buildVersion(env: Env): string {
  const value = env.APP_VERSION?.trim().replace(/^v/i, '') ?? '';
  return /^\d+\.\d+\.\d+([-+][0-9A-Za-z.-]{1,32})?$/.test(value) ? value : DEV_VERSION;
}

/** The short commit: `APP_COMMIT` first, else what git says (`readGit`), else empty. At most 12 characters. */
export function buildCommit(env: Env, readGit: () => string): string {
  const fromEnv = env.APP_COMMIT?.trim();
  if (fromEnv) return fromEnv.slice(0, 12);
  try {
    return readGit().trim().slice(0, 12);
  } catch {
    return '';
  }
}

/** The build time: `APP_BUILD_TIME` when it is a valid time, else `now`, as an ISO string. */
export function buildTime(env: Env, now: Date): string {
  const fromEnv = env.APP_BUILD_TIME?.trim();
  const parsed = fromEnv ? Date.parse(fromEnv) : Number.NaN;
  return new Date(Number.isNaN(parsed) ? now.getTime() : parsed).toISOString();
}

/** The `define` entries (values JSON-encoded, as Vite wants them). */
export function buildDefines(env: Env, readGit: () => string, now: Date): Record<string, string> {
  return {
    __APP_VERSION__: JSON.stringify(buildVersion(env)),
    __APP_BUILT_AT__: JSON.stringify(buildTime(env, now)),
    __APP_COMMIT__: JSON.stringify(buildCommit(env, readGit)),
  };
}
