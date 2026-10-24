import { useEffect, useState } from 'react';
import { readConfig } from './appConfig';
import type { VersionStamp } from './versionInfo';

/** How long the About screen waits for the server before it says the version is unavailable. */
export const SERVER_VERSION_TIMEOUT_MS = 4000;

export type ServerVersionState =
  { status: 'loading' } | { status: 'ok'; stamp: VersionStamp } | { status: 'unavailable' };

/** The API's base URL from the build configuration ('' = same origin). */
function apiBase(): string {
  const config = readConfig();
  return config.ok ? config.config.apiBaseUrl : '';
}

function parseStamp(body: unknown): VersionStamp | null {
  if (typeof body !== 'object' || body === null) return null;
  const { version, commit, builtAt } = body as Record<string, unknown>;
  if (typeof version !== 'string' || version === '') return null;
  return {
    version,
    commit: typeof commit === 'string' ? commit : '',
    builtAt: typeof builtAt === 'string' ? builtAt : null,
  };
}

/**
 * `GET /api/v1/version` (public, no token, no cookie): the server's release, or null when it cannot
 * be read (offline, an error, a timeout, an unexpected answer).
 */
export async function fetchServerVersion(
  base: string = apiBase(),
  timeoutMs: number = SERVER_VERSION_TIMEOUT_MS,
): Promise<VersionStamp | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${base}/api/v1/version`, {
      signal: controller.signal,
      credentials: 'omit',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) return null;
    return parseStamp(await response.json());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** The server's version for a screen: loading first, then ok or unavailable. Never throws. */
export function useServerVersion(): ServerVersionState {
  const [state, setState] = useState<ServerVersionState>({ status: 'loading' });
  useEffect(() => {
    let active = true;
    void fetchServerVersion().then((stamp) => {
      if (active) setState(stamp ? { status: 'ok', stamp } : { status: 'unavailable' });
    });
    return () => {
      active = false;
    };
  }, []);
  return state;
}
