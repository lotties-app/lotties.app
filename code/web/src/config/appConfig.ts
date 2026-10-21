export interface AppConfig {
  apiBaseUrl: string;
  oidc: {
    authority: string;
    clientId: string;
    audience?: string;
  };
}

export type ConfigResult = { ok: true; config: AppConfig } | { ok: false; missing: string[] };

type Env = Record<string, string | undefined>;

const REQUIRED = ['VITE_OIDC_AUTHORITY', 'VITE_OIDC_CLIENT_ID'] as const;

export function readConfig(env: Env = import.meta.env as Env): ConfigResult {
  const missing = REQUIRED.filter((key) => !env[key]?.trim());
  if (missing.length > 0) return { ok: false, missing };

  return {
    ok: true,
    config: {
      apiBaseUrl: (env.VITE_API_BASE_URL ?? '').trim().replace(/\/+$/, ''),
      oidc: {
        authority: env.VITE_OIDC_AUTHORITY!.trim(),
        clientId: env.VITE_OIDC_CLIENT_ID!.trim(),
        audience: env.VITE_OIDC_AUDIENCE?.trim() || undefined,
      },
    },
  };
}
