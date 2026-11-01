# Deploying Baby Routine

The stack is two containers behind your own reverse proxy (or exposed directly for testing):

```
browser --> web (nginx: SPA + security headers) --/api/--> api (.NET 8, :8080, internal only) --> PostgreSQL
```

The browser only talks to the `web` container. nginx serves the SPA and proxies `/api/` to the `api` service, so the app is same origin and needs no CORS configuration.

## Run

```bash
cp .env.example .env     # fill in the values (never commit .env)
docker compose up --build
```

The app is on `http://localhost:8080` (`WEB_PORT` changes the host port).

### External PostgreSQL (recommended)

Set `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_APP_USER`, `DB_APP_PASSWORD` to your database and run `docker compose up --build`. Create the roles and apply the schema first (see [Database roles](#database-roles)).

### Local PostgreSQL (`localdb` profile)

```bash
docker compose --profile localdb up --build
```

Set `DB_HOST=postgres` and `POSTGRES_PASSWORD` (no default; the container refuses to start without it). The container creates `DB_APP_USER` as superuser with that password, so set `DB_APP_PASSWORD` to the same value. Data lives in the named volume `pgdata`, the port is bound to `127.0.0.1:5432` only, and the api waits for the database healthcheck. Intended for local development, not production.

## Environment variables

Compose reads `.env` from the repository root.

| Variable | Used by | Required | Purpose |
|----------|---------|----------|---------|
| `DB_HOST` | api | yes | Database host (`postgres` with `localdb`) |
| `DB_PORT` | api | no (5432) | Database port |
| `DB_NAME` | api, localdb | no (`babyroutine`) | Database name |
| `DB_APP_USER` | api, localdb | yes | Application role |
| `DB_APP_PASSWORD` | api | yes | Application role password |
| `POSTGRES_PASSWORD` | localdb | with `localdb` | Superuser password of the local container (no default) |
| `AUTH_AUTHORITY` | api | yes | OIDC issuer URL |
| `AUTH_AUDIENCE` | api | yes | API audience access tokens must carry |
| `CORS_ALLOWED_ORIGINS` | api | no | Only if the web app is served from a different origin than the API |
| `VITE_OIDC_AUTHORITY` | web build | yes | Issuer URL (same as `AUTH_AUTHORITY`); its origin is added to the CSP `connect-src` |
| `VITE_OIDC_CLIENT_ID` | web build | yes | Public SPA client id |
| `VITE_OIDC_AUDIENCE` | web build | no | Sent as the `audience` authorize parameter (Auth0) |
| `VITE_API_BASE_URL` | web build | no (empty) | Empty = same origin through nginx |
| `WEB_PORT` | compose | no (8080) | Host port of the web container |
| `OIDC_ORIGIN` | web runtime | no | Overrides the CSP OIDC origin derived from `VITE_OIDC_AUTHORITY` |

`VITE_*` values are compiled into the JavaScript bundle at build time and are public. Change them with `docker compose build web` (or `up --build`). Images contain no secrets; database credentials are injected as run-time environment variables.

## Identity provider

The app uses the OIDC authorization code flow with PKCE, scopes `openid profile email offline_access`, and the paths `/auth/callback` (sign-in redirect) and `/login` (post-logout redirect). `${origin}` below is the public URL of the web app, e.g. `https://baby.example.com`.

### Auth0

1. Applications, create an application of type **Single Page Application**. Its client id is `VITE_OIDC_CLIENT_ID`.
2. Allowed Callback URLs: `${origin}/auth/callback`. Allowed Logout URLs: `${origin}/login`. Allowed Web Origins and Allowed Origins (CORS): `${origin}`.
3. APIs, create an API. Its identifier is the audience (`AUTH_AUDIENCE`, `VITE_OIDC_AUDIENCE`). Enable **Allow Offline Access** on the API so `offline_access` issues refresh tokens.
4. In the application, Refresh Token Rotation: on, with a reuse interval of a few seconds and an absolute lifetime that suits you. Silent renew uses the rotating refresh token, not an iframe.
5. `AUTH_AUTHORITY` / `VITE_OIDC_AUTHORITY` is `https://YOUR_TENANT.REGION.auth0.com/` (keep the trailing slash; it must equal the token `iss`).

### Keycloak

1. Realm, Clients, create a client with client authentication **off** (public), standard flow on, PKCE method `S256`.
2. Valid redirect URIs `${origin}/auth/callback`, valid post logout redirect URIs `${origin}/login`, web origins `${origin}`.
3. Audience: add an Audience mapper (client scope) that puts the API id in `aud`; use that value as `AUTH_AUDIENCE` and `VITE_OIDC_AUDIENCE` can stay empty. Refresh tokens are issued with the `offline_access` scope (assign it as an optional or default client scope); enable "Revoke refresh token" for rotation.
4. Authority: `https://HOST/realms/REALM`.

### Authentik

1. Create an OAuth2/OpenID provider: client type **Public**, redirect URI `${origin}/auth/callback`, scope mappings `openid`, `profile`, `email` and `offline_access`, signing key set.
2. Add the provider to an application. The authority is the provider's issuer URL, `https://HOST/application/o/SLUG/`.
3. Set the audience to the client id (Authentik puts it in `aud`), and use it as `AUTH_AUDIENCE`. Post-logout redirect: `${origin}/login`.
4. Enable refresh token rotation if your version offers it; otherwise lower the refresh token validity.

## Reverse proxy and TLS

Terminate TLS in front of the `web` container (Caddy, Traefik, nginx, a cloud load balancer) and forward to port 80 of the container. The inner nginx already forwards `Host` and `X-Forwarded-*` to the API. Requirements:

- Serve the app over HTTPS only; OIDC and the service worker require a secure context (localhost excepted).
- Set `Strict-Transport-Security: max-age=31536000; includeSubDomains` at the TLS proxy. It is documented but intentionally not set in `web/nginx.conf`, because the container speaks plain HTTP and HSTS over HTTP is ignored (and risky to ship before HTTPS works).
- Keep the `api` service unpublished (the compose file does not map its port).
- Request bodies up to 6 MB are allowed (CSV import); do not set a lower limit on the proxy.

The response headers set by the web container are a Content-Security-Policy (`default-src 'self'`, strict `script-src 'self'`, `connect-src 'self'` plus the OIDC origin, `frame-ancestors 'none'`), `X-Content-Type-Options`, `Referrer-Policy: no-referrer` and a minimal `Permissions-Policy`. `sw.js`, `manifest.webmanifest` and `index.html` are served `no-cache` so updates are picked up; `/assets/*` is hashed and `immutable`.

## Token storage trade-off

The OIDC library keeps the user, access token and refresh token in `localStorage`, which is required for offline use and silent renew in a pure SPA. Any script that runs on the page can read them, so the main mitigation is the CSP: no inline or eval scripts and no third-party script origins (`style-src 'unsafe-inline'` is allowed only because MUI/emotion injects styles). Further mitigations: refresh token rotation, short access token lifetimes, and a minimal dependency set (`npm audit` runs in CI). If your threat model needs more, put a backend-for-frontend with HttpOnly cookies in front instead.

## Database roles

The API does not run migrations itself. Apply the EF Core migrations with a separate, more privileged role and run the API with a limited role. The idempotent script is `api/migrations/all.sql`; tooling reads `DB_MIGRATOR_USER` / `DB_MIGRATOR_PASSWORD` (falling back to the app credentials) for `dotnet ef`.

```sql
-- Run as a database administrator. Replace the placeholders; use generated passwords.
CREATE ROLE baby_migrator LOGIN PASSWORD '<generated-migrator-password>';
CREATE ROLE baby_app      LOGIN PASSWORD '<generated-app-password>';

CREATE DATABASE babyroutine OWNER baby_migrator;
REVOKE ALL ON DATABASE babyroutine FROM PUBLIC;
GRANT CONNECT ON DATABASE babyroutine TO baby_app;

\c babyroutine
-- The migrator owns the schema objects it creates.
ALTER SCHEMA public OWNER TO baby_migrator;
GRANT USAGE ON SCHEMA public TO baby_app;

-- Apply the schema as the migrator, e.g.:  psql -U baby_migrator -d babyroutine -f api/migrations/all.sql

-- Run once after the migration, and again after each migration that adds tables:
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO baby_app;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO baby_app;

-- Or make it automatic for objects the migrator creates later:
ALTER DEFAULT PRIVILEGES FOR ROLE baby_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO baby_app;
ALTER DEFAULT PRIVILEGES FOR ROLE baby_migrator IN SCHEMA public
  GRANT USAGE ON SEQUENCES TO baby_app;
```

Put `baby_app` in `DB_APP_USER` / `DB_APP_PASSWORD`. Never give the migrator credentials to the running API container.
