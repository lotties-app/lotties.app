export interface AppConfig {
  apiBaseUrl: string;
  /** OIDC configuration; null when running in local/self-hosted mode (VITE_LOCAL_MODE=true). */
  oidc: {
    authority: string;
    clientId: string;
    audience?: string;
  } | null;
}

export type ConfigResult = { ok: true; config: AppConfig } | { ok: false; missing: string[] };

type Env = Record<string, string | undefined>;

const OIDC_REQUIRED = ['VITE_OIDC_AUTHORITY', 'VITE_OIDC_CLIENT_ID'] as const;

export function readConfig(env: Env = import.meta.env as Env): ConfigResult {
  const isLocalMode = env.VITE_LOCAL_MODE === 'true';

  // In local/self-hosted mode, OIDC is not required — the app uses LocalAuthProvider instead.
  if (!isLocalMode) {
    const missing = OIDC_REQUIRED.filter((key) => !env[key]?.trim());
    if (missing.length > 0) return { ok: false, missing };
  }

  return {
    ok: true,
    config: {
      apiBaseUrl: (env.VITE_API_BASE_URL ?? '').trim().replace(/\/+$/, ''),
      oidc: isLocalMode
        ? null
        : {
            authority: env.VITE_OIDC_AUTHORITY!.trim(),
            clientId: env.VITE_OIDC_CLIENT_ID!.trim(),
            audience: env.VITE_OIDC_AUDIENCE?.trim() || undefined,
          },
    },
  };
}
