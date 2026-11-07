import { readConfig } from '../../config/appConfig';
import { subjectOfToken, writeDemoSession } from './demoSession';

export interface DemoInfo {
  enabled: boolean;
  lifetimeDays: number;
}

export type StartDemoFailure = 'capacity' | 'rateLimited' | 'unavailable' | 'offline';

export class StartDemoError extends Error {
  constructor(readonly reason: StartDemoFailure) {
    super(`Could not start the demo: ${reason}`);
  }
}

const baseUrl = () => {
  const config = readConfig();
  return config.ok ? config.config.apiBaseUrl : '';
};

/** `GET /api/v1/demo`; `null` when the server is unreachable or does not offer the demo. */
export async function fetchDemoInfo(base: string = baseUrl()): Promise<DemoInfo | null> {
  try {
    const response = await fetch(`${base}/api/v1/demo`);
    if (!response.ok) return null;
    const body = (await response.json()) as Partial<DemoInfo>;
    return typeof body.enabled === 'boolean' && typeof body.lifetimeDays === 'number'
      ? { enabled: body.enabled, lifetimeDays: body.lifetimeDays }
      : null;
  } catch {
    return null;
  }
}

/**
 * `POST /api/v1/demo/start`, stores the session and loads `/` (a full page load, so the demo auth
 * provider replaces the OIDC one). Throws `StartDemoError`.
 */
export async function startDemo(
  locale: 'en' | 'pt-BR',
  options: { base?: string; navigate?: (path: string) => void } = {},
): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`${options.base ?? baseUrl()}/api/v1/demo/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ locale }),
    });
  } catch {
    throw new StartDemoError('offline');
  }
  if (response.status === 503) throw new StartDemoError('capacity');
  if (response.status === 429) throw new StartDemoError('rateLimited');
  if (!response.ok) throw new StartDemoError('unavailable');
  const body = (await response.json().catch(() => null)) as {
    accessToken?: string;
    expiresAt?: string;
  } | null;
  const sub = body?.accessToken ? subjectOfToken(body.accessToken) : null;
  if (!body?.accessToken || !body.expiresAt || !sub) throw new StartDemoError('unavailable');
  writeDemoSession({ accessToken: body.accessToken, expiresAt: body.expiresAt, sub });
  (options.navigate ?? ((path) => window.location.assign(path)))('/');
}
