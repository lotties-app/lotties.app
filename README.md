# Baby Routine

Open-source baby event-tracking PWA. Log feeds, sleep, diapers and other routines, share them with your family, and see simple predictions for the next ones. Works offline and syncs when you reconnect.

## Stack

- **web/**: React 19, TypeScript, MUI, Vite, PWA (vite-plugin-pwa)
- **api/**: .NET 8 Web API (Domain / Application / Infrastructure / Api), EF Core + Npgsql
- **Database**: PostgreSQL 16
- **Auth**: generic OIDC (Auth0 default; Keycloak/Authentik via config)
- **Deploy**: docker compose (api + web behind nginx, optional local Postgres)

## Quick start

Prerequisites: .NET 8 SDK, Node 22, and optionally Docker.

```bash
# API
dotnet build api/BabyRoutine.sln
dotnet test api/BabyRoutine.sln

# Web
npm --prefix web ci
npm --prefix web run dev
npm --prefix web run test -- --run
npm --prefix web run lint
npm --prefix web run build
```

With Docker: copy `.env.example` to `.env`, fill in the values, then run `docker compose up`. Add `--profile localdb` to start a local PostgreSQL container too.

## Environment variables

| Variable | Purpose |
|----------|---------|
| `DB_HOST` | Database host (`postgres` with the `localdb` profile) |
| `DB_PORT` | Database port (default 5432) |
| `DB_NAME` | Database name (default `babyroutine`) |
| `DB_APP_USER` | Application database user |
| `DB_APP_PASSWORD` | Application database password |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` | Superuser for the optional `localdb` container only |
| `AUTH_AUTHORITY` | OIDC issuer URL (config `Auth:Authority`); required outside Development |
| `AUTH_AUDIENCE` | API audience that access tokens must carry (config `Auth:Audience`); required outside Development |
| `CORS_ALLOWED_ORIGINS` | Comma-separated browser origins allowed to call the API, e.g. the web app URL (config `Cors:AllowedOrigins`) |

Never commit `.env`. See `.env.example` for placeholders.

## License

AGPL-3.0. See [LICENSE](LICENSE).
