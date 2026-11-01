/**
 * Content-Security-Policy for the iOS/Android build (Vite mode `native`). The web build gets its policy
 * from nginx (code/web/nginx.conf); the app has no server, so the same policy goes into a `<meta>` tag of
 * index.html. `frame-ancestors` cannot be set from a meta tag and the shell cannot be framed anyway.
 * docs/design/12-mobile-capacitor.md section 6.
 */
import { loadEnv, type Plugin } from 'vite';

export const NATIVE_MODE = 'native';

/** The origin of an http(s) URL, or `null` for anything else (empty, relative, another scheme). */
export function originOf(value: string | undefined): string | null {
  try {
    const url = new URL(value ?? '');
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.origin : null;
  } catch {
    return null;
  }
}

/** The policy: own bundle only, plus the API and the identity provider as `fetch` targets. */
export function nativeContentSecurityPolicy(apiBaseUrl?: string, oidcAuthority?: string): string {
  const connect = ["'self'", originOf(apiBaseUrl), originOf(oidcAuthority)].filter(
    (origin): origin is string => origin !== null,
  );
  return [
    "default-src 'self'",
    "script-src 'self'",
    // MUI/emotion injects style elements at run time.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src ${[...new Set(connect)].join(' ')}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
  ].join('; ');
}

/** Adds the policy as a meta tag to index.html in native mode only. */
export function nativeCspPlugin(): Plugin {
  let policy = '';
  let enabled = false;
  return {
    name: 'baby-routine:native-csp',
    configResolved(config) {
      enabled = config.mode === NATIVE_MODE && config.command === 'build';
      const env = loadEnv(config.mode, config.root, 'VITE_');
      policy = nativeContentSecurityPolicy(env.VITE_API_BASE_URL, env.VITE_OIDC_AUTHORITY);
    },
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        if (!enabled) return html;
        const tag = `<meta http-equiv="Content-Security-Policy" content="${policy}" />`;
        return html.replace(/(<meta charset="[^"]*"\s*\/?>)/, `$1\n    ${tag}`);
      },
    },
  };
}
