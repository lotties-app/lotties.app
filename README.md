<p align="center">
  <img src="docs/design/icons/icon-b.svg" alt="Lotties app icon" width="96" height="96">
</p>

<p align="center"><strong>Lotties</strong><br>Track your baby's day, together</p>

# Lotties

Open-source baby event-tracking PWA. Log feeds, sleep, diapers and other routines, share them with your family, and see simple predictions for the next ones. Works offline and syncs when you reconnect.

## Stack

- **code/web/**: React 19, TypeScript, MUI, Vite, PWA (vite-plugin-pwa)
- **code/api/**: .NET 8 Web API (Domain / Application / Infrastructure / Api), EF Core + Npgsql
- **Database**: PostgreSQL 16
- **Auth**: generic OIDC (Auth0 default; Keycloak/Authentik via config)
- **Deploy**: docker compose (api + web behind nginx, optional local Postgres)

## Quick start

Prerequisites: .NET 8 SDK, Node 22, and optionally Docker.

```bash
# API
dotnet build code/api/Lotties.sln
dotnet test code/api/Lotties.sln

# Web
npm --prefix code/web ci
npm --prefix code/web run dev
npm --prefix code/web run test -- --run
npm --prefix code/web run lint
npm --prefix code/web run build
```

With Docker: copy `.env.example` to `.env`, fill in the values, then run `docker compose up --build`. Add `--profile localdb` to start a local PostgreSQL container too. Full deployment guide (identity provider setup, TLS, database roles): [docs/DEPLOY.md](docs/DEPLOY.md).

## Environment variables

| Variable | Purpose |
|----------|---------|
| `DB_HOST` | Database host (`postgres` with the `localdb` profile) |
| `DB_PORT` | Database port (default 5432) |
| `DB_NAME` | Database name (compose default `lotties`) |
| `DB_APP_USER` | Application database user |
| `DB_APP_PASSWORD` | Application database password |
| `DB_AUTO_MIGRATE` | `true` applies pending EF Core migrations at API startup (config `Database:AutoMigrate`); default `false`, for development/self-hosting; production applies them with `dotnet ef` (see [docs/DEPLOY.md](docs/DEPLOY.md) "Applying migrations") |
| `DB_MIGRATOR_USER`, `DB_MIGRATOR_PASSWORD` | Role with DDL rights used to apply migrations (`dotnet ef`, or the API with `DB_AUTO_MIGRATE`); falls back to `DB_APP_*` |
| `POSTGRES_PASSWORD` | Password of the optional `localdb` container (user is `DB_APP_USER`); no default |
| `VITE_OIDC_AUTHORITY`, `VITE_OIDC_CLIENT_ID`, `VITE_OIDC_AUDIENCE`, `VITE_API_BASE_URL` | Web build arguments (public, compiled into the bundle); see [docs/DEPLOY.md](docs/DEPLOY.md) |
| `VITE_REPO_URL` | Optional web build argument: source repository link in the landing page footer (http/https only); empty (default) hides it |
| `AUTH_AUTHORITY` | OIDC issuer URL (config `Auth:Authority`); required outside Development |
| `AUTH_AUDIENCE` | API audience that access tokens must carry (config `Auth:Audience`); required outside Development |
| `CORS_ALLOWED_ORIGINS` | Comma-separated browser origins allowed to call the API, e.g. the web app URL (config `Cors:AllowedOrigins`); not needed when the web container proxies `/api/` (default) |
| `PUSH_VAPID_PUBLIC_KEY`, `PUSH_VAPID_PRIVATE_KEY`, `PUSH_VAPID_SUBJECT` | Optional Web Push (config `Push:Vapid:*`); all three set = push on, none = off; generate with `--generate-vapid-keys`; see [docs/DEPLOY.md](docs/DEPLOY.md) "Push notifications" |

Never commit `.env`. See `.env.example` for placeholders.

## License

AGPL-3.0. See [LICENSE](LICENSE).
