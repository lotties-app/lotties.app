# 39. Self-hosting page and configuration generator

Route `/self-host` (public, no sign-in, like `/install` and `/privacy`), linked from the landing footer and the README.

## Why

`lotties.app` is only the instance the maintainers run. They are responsible for the data on that instance and for the privacy
terms published there. Anyone who runs their own copy is the operator of that copy. The README, `docs/DEPLOY.md` and this page say
so plainly, and the privacy policy already says "a copy run by someone else is that operator's responsibility ... this policy
covers only lotties.app" (same wording in pt-BR); nothing there changed.

## Page

`code/web/src/selfHost/SelfHostPage.tsx`: what you need (a server with Docker or Podman, a domain with HTTPS, an OIDC provider,
PostgreSQL), who is responsible, the steps, the generator, where the data lives, updating, links into `docs/DEPLOY.md` (built from
`VITE_REPO_URL`; plain text when it is empty). It gives no medical advice and says it is not a medical app. Text:
`i18n/locales/{en,pt-BR}/selfHost.json` (namespace `selfHost`) and `landing.footer.selfHost`.

## Generator

`SelfHostGenerator.tsx` is a form; every output comes from the pure module `generate.ts`:

- `validateInput` returns a problem code per field (`required`, `invalidUrl`, `invalidHttpsUrl`, `invalidPort`, ...). https is
  required except for localhost; ports 1-65535; database names are SQL identifiers; origins have no path; the push set is all or none.
- `buildEnvFile` writes only variable names documented in `docs/DEPLOY.md` (a test checks it), with `# SECRET` and `# PUBLIC`
  markers. `envValue` quotes: bare when plain, single quotes (literal) otherwise, double quotes with `$` doubled when the value has a
  single quote; control characters are refused.
- `buildComposeFile` mirrors the root `docker-compose.yml` (a test checks every `${VAR}` exists there and the healthcheck line is
  identical). Every value is a `${VAR}` reference, so the file holds no secret and no typed value. The `postgres` service is added
  without a profile and without a published port when "bundled PostgreSQL" is chosen.
- `secrets.ts`: `randomPassword` (letters and digits, rejection sampling over `crypto.getRandomValues`) and `generateVapidPair`
  (WebCrypto ECDSA P-256; public key = raw 65-byte point, private key = the 32-byte JWK `d`, both base64url, the format
  `--generate-vapid-keys` prints).

Public (compiled into the bundle): all `VITE_*`, the VAPID public key, `WEB_PORT`, `CORS_ALLOWED_ORIGINS`. Secret:
`DB_APP_PASSWORD`, `POSTGRES_PASSWORD`, `PUSH_VAPID_PRIVATE_KEY`.

## Privacy

The generator adds no data flow: nothing typed or generated is sent, logged or stored (no `localStorage`, no request; state lives in
the component until the page closes; a test asserts no fetch and no secret in storage). The only browser APIs are the clipboard and
a Blob download triggered by the person. So the privacy policy, `legal/dataFlows.ts` and the audit are unchanged.

## Not verified

There is no Docker on the dev machine: the generated compose file was never run, only compared with the repository's file by tests
and by eye. The page says so next to the file.

## Possible follow-ups

Kubernetes output, an "external reverse proxy" snippet (Caddy/Traefik), `DB_MIGRATOR_*` fields, Alexa/MCP settings.
