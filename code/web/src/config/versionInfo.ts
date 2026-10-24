/*
 * The running versions (docs/DEPLOY.md "Versions"): this device's bundle and the server's API, both
 * stamped by deploy/homelab/deploy.sh with the release X.Y.Z, or `dev` when a build was not stamped.
 */

/** The version of a build, as the About screen and the small version lines show it. */
export interface VersionStamp {
  version: string;
  commit: string;
  /** ISO time, empty or null when unknown. */
  builtAt: string | null;
}

const RELEASE = /^(\d+)\.(\d+)\.(\d+)$/;

/** `v0.1.38` for a release, the value as it is otherwise (`dev`). */
export function displayVersion(version: string): string {
  return RELEASE.test(version) ? `v${version}` : version;
}

/** The first 7 characters of a commit, the usual short form. */
export function shortCommit(commit: string): string {
  return commit.slice(0, 7);
}
