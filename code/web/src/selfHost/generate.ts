/**
 * Pure logic of the self-host generator (docs/design/39-self-hosting-page.md): validates typed values and
 * renders a `.env` and a `docker-compose.yml`. No I/O, no randomness: secrets arrive as input (see secrets.ts),
 * and nothing here reads or writes storage or the network. Variable names are exactly those of docs/DEPLOY.md.
 */

export type DbMode = 'bundled' | 'external';

export interface SelfHostInput {
  /** Public address of the app, e.g. https://baby.example.com. Only used to show identity provider settings. */
  publicUrl: string;
  /** Host port of the web container (`WEB_PORT`). */
  webPort: string;
  oidcAuthority: string;
  oidcClientId: string;
  /** `AUTH_AUDIENCE`: the API audience tokens must carry. */
  apiAudience: string;
  /** Also send the audience as the authorize parameter (`VITE_OIDC_AUDIENCE`, Auth0). */
  sendAudience: boolean;
  dbMode: DbMode;
  dbHost: string;
  dbPort: string;
  dbName: string;
  dbUser: string;
  /** Secret. Also `POSTGRES_PASSWORD` with the bundled database. */
  dbPassword: string;
  autoMigrate: boolean;
  corsOrigins: string;
  pushEnabled: boolean;
  vapidPublicKey: string;
  /** Secret. */
  vapidPrivateKey: string;
  vapidSubject: string;
  privacyControllerName: string;
  privacyContactEmail: string;
  privacyDpo: string;
  repoUrl: string;
}

export const DEFAULT_INPUT: SelfHostInput = {
  publicUrl: '',
  webPort: '8080',
  oidcAuthority: '',
  oidcClientId: '',
  apiAudience: '',
  sendAudience: false,
  dbMode: 'bundled',
  dbHost: '',
  dbPort: '5432',
  dbName: 'lotties',
  dbUser: 'lotties_app',
  dbPassword: '',
  autoMigrate: true,
  corsOrigins: '',
  pushEnabled: false,
  vapidPublicKey: '',
  vapidPrivateKey: '',
  vapidSubject: '',
  privacyControllerName: '',
  privacyContactEmail: '',
  privacyDpo: '',
  repoUrl: '',
};

export type FieldProblem =
  | 'required'
  | 'invalidUrl'
  | 'invalidHttpsUrl'
  | 'invalidPort'
  | 'invalidHost'
  | 'invalidIdentifier'
  | 'invalidEmail'
  | 'invalidOrigins'
  | 'invalidSubject'
  | 'tooLong'
  | 'controlCharacters';

export type FieldErrors = Partial<Record<keyof SelfHostInput, FieldProblem>>;

const MAX_TEXT = 200;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;
const HOST =
  /^(?=.{1,253}$)([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/;
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;
const EMAIL = /^[^\s@<>"'`]+@[^\s@<>"'`]+\.[^\s@<>"'`]+$/;

function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

const isLoopback = (host: string) =>
  host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host.endsWith('.localhost');

/** An https address; plain http only for a local machine (OIDC and the service worker need a secure context). */
function webAddressProblem(value: string, requireHttps: boolean): FieldProblem | null {
  const url = parseUrl(value);
  if (!url || (url.protocol !== 'https:' && url.protocol !== 'http:')) return 'invalidUrl';
  if (url.username || url.password) return 'invalidUrl';
  if (requireHttps && url.protocol !== 'https:' && !isLoopback(url.hostname)) {
    return 'invalidHttpsUrl';
  }
  return null;
}

function portProblem(value: string): FieldProblem | null {
  if (!/^\d{1,5}$/.test(value)) return 'invalidPort';
  const n = Number(value);
  return n >= 1 && n <= 65535 ? null : 'invalidPort';
}

const splitList = (value: string) =>
  value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

function isOrigin(value: string): boolean {
  const url = parseUrl(value);
  if (!url || !url.host) return false;
  // `new URL('capacitor://localhost').origin` is opaque, so compare the parts instead.
  return `${url.protocol}//${url.host}` === value.replace(/\/$/, '') && !url.search && !url.hash;
}

function isVapidSubject(value: string): boolean {
  if (value.startsWith('mailto:')) return EMAIL.test(value.slice('mailto:'.length));
  const url = parseUrl(value);
  return !!url && url.protocol === 'https:';
}

/** What is wrong with each field, empty when the input can be rendered. Optional fields pass when empty. */
export function validateInput(input: SelfHostInput): FieldErrors {
  const errors: FieldErrors = {};
  const set = (key: keyof SelfHostInput, problem: FieldProblem | null) => {
    if (problem && !errors[key]) errors[key] = problem;
  };
  const text = (key: keyof SelfHostInput, required: boolean) => {
    const value = String(input[key]);
    if (CONTROL.test(value)) set(key, 'controlCharacters');
    else if (value.length > MAX_TEXT) set(key, 'tooLong');
    else if (required && value.trim() === '') set(key, 'required');
  };

  text('privacyControllerName', false);
  text('privacyDpo', false);
  text('apiAudience', true);
  text('oidcClientId', true);
  text('publicUrl', true);
  text('oidcAuthority', true);
  text('repoUrl', false);
  text('corsOrigins', false);
  text('vapidSubject', false);
  text('privacyContactEmail', false);
  if (/\s/.test(input.oidcClientId.trim())) set('oidcClientId', 'controlCharacters');

  if (!errors.publicUrl) set('publicUrl', webAddressProblem(input.publicUrl.trim(), true));
  if (!errors.oidcAuthority) {
    set('oidcAuthority', webAddressProblem(input.oidcAuthority.trim(), true));
  }
  if (input.repoUrl.trim() && !errors.repoUrl) {
    set('repoUrl', webAddressProblem(input.repoUrl.trim(), false));
  }
  set('webPort', portProblem(input.webPort.trim()));

  if (input.dbMode === 'external') {
    const host = input.dbHost.trim();
    set('dbHost', host === '' ? 'required' : HOST.test(host) ? null : 'invalidHost');
    set('dbPort', portProblem(input.dbPort.trim()));
  }
  for (const key of ['dbName', 'dbUser'] as const) {
    const value = input[key].trim();
    set(key, value === '' ? 'required' : IDENTIFIER.test(value) ? null : 'invalidIdentifier');
  }
  if (input.dbPassword === '') set('dbPassword', 'required');
  else if (CONTROL.test(input.dbPassword)) set('dbPassword', 'controlCharacters');

  if (!errors.corsOrigins && splitList(input.corsOrigins).some((o) => !isOrigin(o))) {
    set('corsOrigins', 'invalidOrigins');
  }

  const email = input.privacyContactEmail.trim();
  if (email && !EMAIL.test(email)) set('privacyContactEmail', 'invalidEmail');

  if (input.pushEnabled) {
    if (input.vapidPublicKey.trim() === '') set('vapidPublicKey', 'required');
    if (input.vapidPrivateKey.trim() === '') set('vapidPrivateKey', 'required');
    const subject = input.vapidSubject.trim();
    if (subject === '') set('vapidSubject', 'required');
    else if (!isVapidSubject(subject)) set('vapidSubject', 'invalidSubject');
  }
  return errors;
}

/** The origin of a web address (`https://baby.example.com/x` gives `https://baby.example.com`). */
export function originOf(value: string): string | null {
  const url = parseUrl(value.trim());
  return url && (url.protocol === 'https:' || url.protocol === 'http:') ? url.origin : null;
}

/** The settings to enter at the identity provider (docs/DEPLOY.md "Identity provider"). */
export function identityProviderSettings(publicUrl: string) {
  const origin = originOf(publicUrl);
  if (!origin) return null;
  return { callback: `${origin}/auth/callback`, logout: `${origin}/login`, webOrigin: origin };
}

// --- .env -------------------------------------------------------------------------------------------------------

const SAFE_BARE = /^[A-Za-z0-9_@%+=:,./-]*$/;

/**
 * One value for a Compose `.env` line. Plain values stay bare; anything else is single-quoted (literal: no `$`
 * interpolation); a value with a single quote uses double quotes with `\`, `"` and `$` escaped. Throws on a
 * newline or other control character, which validateInput already rejects.
 */
export function envValue(value: string): string {
  if (CONTROL.test(value)) throw new Error('A .env value cannot contain control characters.');
  if (SAFE_BARE.test(value)) return value;
  if (!value.includes("'")) return `'${value}'`;
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\$/g, '$$$$')}"`;
}

const line = (name: string, value: string) => `${name}=${envValue(value)}`;

function requireValid(input: SelfHostInput) {
  const errors = validateInput(input);
  if (Object.keys(errors).length > 0) {
    throw new Error(`Invalid input: ${Object.keys(errors).join(', ')}`);
  }
}

/** The `.env` file. Public build values and secrets are in marked sections. */
export function buildEnvFile(input: SelfHostInput): string {
  requireValid(input);
  const bundled = input.dbMode === 'bundled';
  const authority = input.oidcAuthority.trim();
  const audience = input.apiAudience.trim();
  const out: string[] = [
    '# Lotties configuration, made by the self-hosting page. Keep this file private and never commit it.',
    '# Reference: docs/DEPLOY.md. Lines marked SECRET must not be shared; lines marked PUBLIC end up in the web bundle.',
    '',
    '# --- Database (api) ---',
    line('DB_HOST', bundled ? 'postgres' : input.dbHost.trim()),
    line('DB_PORT', bundled ? '5432' : input.dbPort.trim()),
    line('DB_NAME', input.dbName.trim()),
    line('DB_APP_USER', input.dbUser.trim()),
    '# SECRET',
    line('DB_APP_PASSWORD', input.dbPassword),
    line('DB_AUTO_MIGRATE', String(input.autoMigrate)),
  ];
  if (bundled) {
    out.push(
      '# SECRET: password of the bundled PostgreSQL container, the same value as DB_APP_PASSWORD.',
      line('POSTGRES_PASSWORD', input.dbPassword),
    );
  }
  out.push(
    '',
    '# --- Sign-in: OIDC provider (api) ---',
    line('AUTH_AUTHORITY', authority),
    line('AUTH_AUDIENCE', audience),
    line('CORS_ALLOWED_ORIGINS', splitList(input.corsOrigins).join(',')),
  );
  if (input.pushEnabled) {
    out.push(
      '',
      '# --- Web Push (api) ---',
      '# PUBLIC key, sent to browsers',
      line('PUSH_VAPID_PUBLIC_KEY', input.vapidPublicKey.trim()),
      '# SECRET',
      line('PUSH_VAPID_PRIVATE_KEY', input.vapidPrivateKey.trim()),
      line('PUSH_VAPID_SUBJECT', input.vapidSubject.trim()),
    );
  }
  out.push(
    '',
    '# --- PUBLIC web build values: compiled into the JavaScript bundle at `docker compose build` ---',
    line('VITE_OIDC_AUTHORITY', authority),
    line('VITE_OIDC_CLIENT_ID', input.oidcClientId.trim()),
    line('VITE_OIDC_AUDIENCE', input.sendAudience ? audience : ''),
    line('VITE_API_BASE_URL', ''),
    line('VITE_REPO_URL', input.repoUrl.trim()),
    line('VITE_PRIVACY_CONTROLLER_NAME', input.privacyControllerName.trim()),
    line('VITE_PRIVACY_CONTACT_EMAIL', input.privacyContactEmail.trim()),
    line('VITE_PRIVACY_DPO', input.privacyDpo.trim()),
    '',
    '# Host port of the web container; put your TLS reverse proxy in front of it.',
    line('WEB_PORT', input.webPort.trim()),
    '',
  );
  return out.join('\n');
}

// --- docker-compose.yml -----------------------------------------------------------------------------------------

const HEALTHCHECK =
  '["CMD", "bash", "-c", "exec 3<>/dev/tcp/127.0.0.1/8080 && printf \'GET /health HTTP/1.0\\\\r\\\\nHost: localhost\\\\r\\\\n\\\\r\\\\n\' >&3 && head -n1 <&3 | grep -q \' 200 \'"]';

/**
 * The compose file. Every value is a `${VAR}` reference to the `.env` file, so no secret is written here; the
 * services mirror the repository's docker-compose.yml (build contexts are the repository folders).
 */
export function buildComposeFile(input: SelfHostInput): string {
  requireValid(input);
  const bundled = input.dbMode === 'bundled';
  const api = [
    'ASPNETCORE_URLS: http://+:8080',
    'DB_HOST: ${DB_HOST:?set DB_HOST in .env}',
    'DB_PORT: ${DB_PORT:-5432}',
    'DB_NAME: ${DB_NAME:-lotties}',
    'DB_APP_USER: ${DB_APP_USER:?set DB_APP_USER in .env}',
    'DB_APP_PASSWORD: ${DB_APP_PASSWORD:?set DB_APP_PASSWORD in .env}',
    'DB_AUTO_MIGRATE: ${DB_AUTO_MIGRATE:-false}',
    'AUTH_AUTHORITY: ${AUTH_AUTHORITY:?set AUTH_AUTHORITY in .env}',
    'AUTH_AUDIENCE: ${AUTH_AUDIENCE:?set AUTH_AUDIENCE in .env}',
    'CORS_ALLOWED_ORIGINS: ${CORS_ALLOWED_ORIGINS:-}',
  ];
  if (input.pushEnabled) {
    api.push(
      'PUSH_VAPID_PUBLIC_KEY: ${PUSH_VAPID_PUBLIC_KEY:-}',
      'PUSH_VAPID_PRIVATE_KEY: ${PUSH_VAPID_PRIVATE_KEY:-}',
      'PUSH_VAPID_SUBJECT: ${PUSH_VAPID_SUBJECT:-}',
    );
  }
  const out: string[] = [
    '# Lotties, made by the self-hosting page. Run it from the root of the Lotties source folder, next to the .env file:',
    '#   docker compose up --build        (or: podman-compose up --build)',
    '# Every value comes from .env, so this file holds no secret. Reference: docs/DEPLOY.md.',
    'services:',
    '  api:',
    '    build: ./code/api',
    '    environment:',
    ...api.map((l) => `      ${l}`),
    '    # Not published to the host: the browser reaches the API through the web container (/api/).',
    '    expose:',
    '      - "8080"',
  ];
  if (bundled) {
    out.push('    depends_on:', '      postgres:', '        condition: service_healthy');
  }
  out.push(
    '    healthcheck:',
    `      test: ${HEALTHCHECK}`,
    '      interval: 30s',
    '      timeout: 5s',
    '      start_period: 20s',
    '      retries: 3',
    '    restart: unless-stopped',
    '',
    '  web:',
    '    build:',
    '      context: ./code/web',
    '      args:',
    '        VITE_API_BASE_URL: ${VITE_API_BASE_URL:-}',
    '        VITE_OIDC_AUTHORITY: ${VITE_OIDC_AUTHORITY:?set VITE_OIDC_AUTHORITY in .env}',
    '        VITE_OIDC_CLIENT_ID: ${VITE_OIDC_CLIENT_ID:?set VITE_OIDC_CLIENT_ID in .env}',
    '        VITE_OIDC_AUDIENCE: ${VITE_OIDC_AUDIENCE:-}',
    '        VITE_REPO_URL: ${VITE_REPO_URL:-}',
    '        VITE_PRIVACY_CONTROLLER_NAME: ${VITE_PRIVACY_CONTROLLER_NAME:-}',
    '        VITE_PRIVACY_CONTACT_EMAIL: ${VITE_PRIVACY_CONTACT_EMAIL:-}',
    '        VITE_PRIVACY_DPO: ${VITE_PRIVACY_DPO:-}',
    '    ports:',
    '      - "${WEB_PORT:-8080}:8080"',
    '    depends_on:',
    '      - api',
    '    restart: unless-stopped',
  );
  if (bundled) {
    out.push(
      '',
      '  # PostgreSQL in a container, data in the named volume pgdata. Not published to the host.',
      '  postgres:',
      '    image: postgres:16',
      '    environment:',
      '      POSTGRES_DB: ${DB_NAME:-lotties}',
      '      POSTGRES_USER: ${DB_APP_USER:?set DB_APP_USER in .env}',
      '      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?set POSTGRES_PASSWORD in .env}',
      '    volumes:',
      '      - pgdata:/var/lib/postgresql/data',
      '    healthcheck:',
      '      test: ["CMD-SHELL", "pg_isready -U $${POSTGRES_USER} -d $${POSTGRES_DB}"]',
      '      interval: 5s',
      '      timeout: 3s',
      '      retries: 10',
      '    restart: unless-stopped',
      '',
      'volumes:',
      '  pgdata:',
    );
  }
  out.push('');
  return out.join('\n');
}
