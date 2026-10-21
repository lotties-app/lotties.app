# Deploying Lotties

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
| `PUSH_VAPID_PUBLIC_KEY`, `PUSH_VAPID_PRIVATE_KEY`, `PUSH_VAPID_SUBJECT` | api | no (all or none) | Web Push; see "Push notifications" |
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

## Keycloak theme

The login pages of Keycloak (sign in, register, reset password, verify email, one-time codes, errors) can use the Lotties look: `code/keycloak-theme/` is a Keycloakify 11 login theme named `lotties` (design tokens mirrored from the app, Fraunces serif, the nap and bottle illustrations, light and dark by `prefers-color-scheme`, English and Brazilian Portuguese). It is optional: without it Keycloak keeps its own theme and everything still works. Full guide: `code/keycloak-theme/README.md`.

1. Get the jar: download the `lotties-keycloak-theme` artifact of the *Keycloak theme* workflow, or build it without Java on your machine: `bash code/keycloak-theme/build-in-podman.sh` (Windows: `powershell -File code/keycloak-theme/build-in-podman.ps1`, which calls WSL). The result is `code/keycloak-theme/dist_keycloak/keycloak-theme-for-kc-all-other-versions.jar` (Keycloak 26 and newer; `KC_TARGETS=all` also builds the 22-25 jar).
2. Put it in Keycloak's `providers/` folder. Container: mount it read-only at `/opt/keycloak/providers/lotties-theme.jar`:

   ```yaml
   services:
     keycloak:
       image: quay.io/keycloak/keycloak:26.8
       command: start   # or start-dev for tests
       volumes:
         - ./lotties-theme.jar:/opt/keycloak/providers/lotties-theme.jar:ro
   ```

   In the optimized (production) mode run `kc.sh build` once after adding the jar (with the official image: build your own image `FROM quay.io/keycloak/keycloak` + `COPY` the jar + `RUN /opt/keycloak/bin/kc.sh build`). `start-dev` and a plain `start` after a restart pick it up.
3. Realm settings > Themes > **Login theme** = `lotties`, Save. Enable Realm settings > Localization > Internationalization with `English` and `Portuguese (Brazil)` (the language switcher only appears when more than one language is enabled).
4. Keep the app client as before (public, PKCE `S256`). The theme changes no flow and no setting of the realm.

Replace the placeholder terms text (message key `termsText`) in Realm settings > Localization if you enable the *Terms and conditions* required action.

## Installing the Keycloak theme on Kubernetes (Bitnami chart)

Target: Helm release `keycloak` (chart `bitnami/keycloak` 24.0.5, app 26.0.5, image `docker.io/bitnamilegacy/keycloak:26.0.5-debian-12-r0`), production mode, `readOnlyRootFilesystem: true`, `runAsUser`/`fsGroup` 1001. `/opt/bitnami/keycloak/themes` is not writable, so the theme is installed in **directory mode**: an init container fills an `emptyDir`, Keycloak mounts it under `themes/`. No jar, no `kc.sh build`, no image rebuild. Everything below lives in `code/keycloak-theme/deploy/` and was verified against the real 26.0.5 Bitnami image (see "What was verified").

### 1. Package the theme

```bash
bash code/keycloak-theme/deploy/package-theme.sh        # builds the jar in podman (build-in-podman.sh), unpacks theme/ from it
# SKIP_BUILD=1 reuses code/keycloak-theme/dist_keycloak/*.jar
```

Keycloakify emits only the jar; the script takes the `theme/lotties/` folder out of it, checks the structure Keycloak 26 expects (`login/theme.properties` with `parent=keycloak`, `login/*.ftl`, `login/resources/`, `login/messages/`) and writes `deploy/out/theme/lotties/` (plain directory), `deploy/out/lotties-theme.tar.gz` (top folder `lotties/`) and a `.sha256` file (all git-ignored).

### 2. Choose a delivery route

| Route | What | Values file |
| --- | --- | --- |
| **A** OCI image on ghcr.io | Workflow `.github/workflows/keycloak-theme-image.yml` (manual dispatch, or push a tag `keycloak-theme-v0.1.0`) publishes `ghcr.io/<owner>/lotties-keycloak-theme:<version>` and attaches the tarball and checksum to the release | `values-theme-oci.yaml` |
| **B** your own registry | `bash deploy/build-image.sh`, then push (below) | `values-theme-oci.yaml` with your image |
| **C** no registry | init container (`curlimages/curl`) downloads the tarball from a URL (release asset), verifies its sha256, unpacks it | `values-theme-url.yaml` |
| **Multi-theme (recommended for a shared IdP)** | one volume over the whole `themes/` dir, image with N theme folders | `values-theme-multi-oci.yaml` |

Route B:

```bash
IMAGE_REPO=registry.example.com/apps/lotties-keycloak-theme bash code/keycloak-theme/deploy/build-image.sh
podman login registry.example.com
podman push registry.example.com/apps/lotties-keycloak-theme:0.1.0   # or PUSH=1 on the build command
```

Then set that image in the values file (`initContainers[0].image`). A private registry or a private ghcr package needs a pull secret (`global.imagePullSecrets`, see the comments in the values file). Route C: copy the first column of `deploy/out/lotties-theme.tar.gz.sha256` into `THEME_SHA256` and the release-asset URL into `THEME_URL`; a wrong checksum fails the init container on purpose (during a rolling update the old pod keeps running).

### 3. Review, upgrade, check

Each values file is a second `-f` after yours. Helm replaces lists instead of merging them: the owner's `values.yaml` has `initContainers`, `extraVolumes` and `extraVolumeMounts` empty, so nothing is lost; merge by hand if that changes. **Check the image first:** `values.yaml` has no `image:` block, yet the cluster runs `bitnamilegacy/keycloak`. Run `helm get values keycloak -n keycloak` and make sure whatever sets `image.repository` (and `global.security.allowInsecureImages` if used) is part of the upgrade command, otherwise the upgrade would also change the Keycloak image.

```bash
# render only, no cluster contact
helm template keycloak oci://registry-1.docker.io/bitnamicharts/keycloak --version 24.0.5 -n keycloak \
  -f values.yaml --set image.repository=bitnamilegacy/keycloak --set global.security.allowInsecureImages=true -f code/keycloak-theme/deploy/values-theme-oci.yaml | grep -n -B2 -A8 br-theme

# the change itself (the owner runs it). IMPORTANT: use --reuse-values. The running release carries user values
# that are NOT in helms/home-lab/main/keycloak/values.yaml: image.repository=bitnamilegacy/keycloak and
# global.security.allowInsecureImages=true. A plain `-f values.yaml` upgrade would drop them and switch Keycloak
# back to the default Bitnami image. Check first: `helm get values keycloak -n keycloak` (it contains secrets: never paste it anywhere).
helm upgrade keycloak oci://registry-1.docker.io/bitnamicharts/keycloak --version 24.0.5 -n keycloak \
  --reuse-values -f code/keycloak-theme/deploy/values-theme-oci.yaml

kubectl -n keycloak rollout status statefulset/keycloak
kubectl -n keycloak logs keycloak-0 -c br-theme-init          # "lotties theme copied"
kubectl -n keycloak exec keycloak-0 -c keycloak -- ls /opt/bitnami/keycloak/themes/lotties/login
```

The StatefulSet restarts (single replica: a short outage of the IdP, plan it). Rendered with `helm template` against the owner's `values.yaml` plus each values file, the only differences from the current manifest are one initContainer, one volume and one volumeMount at exactly `/opt/bitnami/keycloak/themes/lotties` (multi variant: `/opt/bitnami/keycloak/themes`).

**Internal registry (route B, done for this project):** the theme image `cr.homel4b.dev/lotties/keycloak-theme:0.1.0` is published in the private Harbor project `lotties` (moved from `baby-routine` on 2026-10-21; images 0.1.0 to 0.3.0 were first pushed under the old project) with the robot account that is logged in inside WSL (`podman push`). Because the project is private, create the pull secret `cr-homel4b` in the `keycloak` namespace before the upgrade (command in `values-theme-oci.yaml`); the values file already references it under `image.pullSecrets`. To publish a new version: bump `code/keycloak-theme/package.json`, run `bash code/keycloak-theme/build-in-podman.sh && bash code/keycloak-theme/deploy/package-theme.sh && IMAGE_REPO=cr.homel4b.dev/lotties/keycloak-theme PUSH=1 bash code/keycloak-theme/deploy/build-image.sh`, update the tag in the values file and run the upgrade. (Images up to 0.2.0 contain the theme under its old name `baby-routine`; from 0.3.0 the theme is named `lotties`, see "Renaming the theme" below.)

**Renaming the theme (`baby-routine` to `lotties`, image 0.3.0):** the deployed realm still uses the login theme `baby-routine`, so change it in this order to avoid a window where the realm names a theme that is absent:

1. Build and push the 0.3.0 image (contains `themes/lotties`), then `helm upgrade ... --reuse-values -f code/keycloak-theme/deploy/values-theme-oci.yaml` (the values file now mounts `/opt/bitnami/keycloak/themes/lotties`). Check: `kubectl -n keycloak exec keycloak-0 -c keycloak -- ls /opt/bitnami/keycloak/themes/lotties/login`. Until step 2 the realm names the now-absent `baby-routine` theme and shows Keycloak's default look (logins keep working).
2. `bash code/keycloak-theme/deploy/configure-realm.sh --dry-run`, then without `--dry-run`: `KC_THEME` now defaults to `lotties`, and the script refuses to run until the server lists that theme.
3. Rollback: `helm rollback keycloak <previous-revision> -n keycloak` (brings back the 0.2.0 image with `baby-routine`), then `KC_THEME=baby-routine bash code/keycloak-theme/deploy/configure-realm.sh` to point the realm back.

**Rollback:** `helm history keycloak -n keycloak`, then `helm rollback keycloak <previous-revision> -n keycloak`, or use `helm rollback` for a clean revert (re-running the upgrade without the theme file keeps the theme pieces, because `--reuse-values` keeps the previous user values). A realm that still names `lotties` while the theme is absent falls back to Keycloak's default look.

### 4. Configure the realm

Admin console: Realm settings > Themes > Login theme = `lotties`; Localization > Internationalization on, English + Portuguese (Brazil). Or scripted and idempotent (curl + jq; credentials only from the environment, never printed):

```bash
export KC_URL=https://auth.homel4b.dev KC_REALM=lotties.app KC_ADMIN_USER=admin KC_ADMIN_PASSWORD='...'   # from your secret store
bash code/keycloak-theme/deploy/configure-realm.sh --dry-run    # prints the intended changes, writes nothing
bash code/keycloak-theme/deploy/configure-realm.sh              # applies; a second run says "Nothing to do"
```

Outside `--dry-run` it refuses to run when `/admin/serverinfo` does not list the theme yet. Existing supported locales and the default locale are kept; `en` and `pt-BR` are added.

### Multi-theme layout for a shared IdP (recommended)

The Keycloak is used by many apps, so mount **one** volume over the whole `themes/` directory instead of one mount per theme (`values-theme-multi-oci.yaml`): the init container copies `/themes/*` from an image into the `emptyDir`; the image can hold N folders. This hides nothing Keycloak needs: the built-in themes (`base`, `keycloak`, `keycloak.v2`) are inside the server jar, and the image's `themes/` directory only holds a `README.md` (checked on 26.0.5-debian-12-r0).

```bash
bash code/keycloak-theme/deploy/package-multi.sh                      # out/themes/{lotties,example-other-app}
MULTI=1 IMAGE_REPO=registry.example.com/apps/lotties-keycloak-themes bash code/keycloak-theme/deploy/build-image.sh
```

Each client (or realm) picks its theme: client attribute `login_theme` (admin console: client > Settings > Login settings > Login theme) or the realm's Login theme; the client's choice wins.

**Adding another theme:** (1) put a ready theme folder in `deploy/themes-extra/<name>/login/...`, or for a pure re-colouring a `deploy/themes-extra/<name>/skin.css`; (2) run `package-multi.sh` and build the image with a **new tag**; (3) set the tag in the values file and `helm upgrade`; (4) set the theme on the app's client. Every theme change restarts the shared IdP pod, so batch changes.

*Skin without rebuild:* `make-child-theme.sh <name> <skin.css>` creates a child theme (`theme.properties` with `parent=lotties`, the parent's `.ftl` pages each with one extra `<link>` to `resources/css/skin.css`; JS, fonts, images and messages come from the parent through Keycloak's parent chain). The CSS overrides the theme's CSS variables (`--br-accent`, ...): use `html:root { ... }` for specificity (the theme stylesheet is injected after the skin link) and repeat the values inside `@media (prefers-color-scheme: light)` for the light scheme. The placeholder `example-other-app` (blue accent) is built this way. The extra `<link>` is needed because Keycloakify pages ignore the `styles=` theme property.

*Hot reload alternative (development only):* a git-sync sidecar writing into the shared volume plus `--spi-theme--cache-themes=false --spi-theme--cache-templates=false` (`KC_SPI_THEME_CACHE_THEMES=false`, `KC_SPI_THEME_CACHE_TEMPLATES=false`) so Keycloak re-reads files. Do not run a production IdP like that: caches off slow every page, and a bad push breaks every app's login page without a rollout and without `helm rollback`. In production every theme change goes through an image tag and a pod restart.

### Security of login-page themes

A login theme runs on the page where users type passwords, on the IdP origin. Treat it like auth code: no third-party scripts, fonts or analytics (the theme loads only its own files), review every theme change, pin image tags (never `latest`) and verify what you deploy. Route C has a mandatory sha256; for images use immutable digests (`image: repo@sha256:...`) and sign them (for example `cosign sign` with the GitHub OIDC identity and `cosign verify` in an admission policy), or at least publish only from the workflow above.

### The jar-in-providers alternative (not recommended here)

The chart's `/opt/bitnami/keycloak/providers` is on the writable `empty-dir`, so an init container could copy the Keycloakify jar there (next to the metrics SPI jar). Keycloak then re-augments at start when the provider set changed, which lengthens startup (the liveness probe starts after 300 s today) and needs CPU and memory for the build (it writes to `lib/quarkus`, also writable). Risks: slower, riskier restarts, a broken jar blocks the whole IdP, and the pre-built optimized state of the image is not used. Directory mode avoids all of that; use the jar where you control the image build (`kc.sh build` is needed in jar mode only).

### Troubleshooting

- **Theme not listed in the realm's Login theme dropdown:** check the init container log; `ls /opt/bitnami/keycloak/themes/lotties/login/theme.properties` in the pod (single layout: the volume is the theme folder itself, `login/` directly inside; multi layout: `themes/lotties/login/`); restart the pod after changes. Tarball extraction needs `--strip-components=1`.
- **Blank page:** the page is a React SPA; open the browser console. 404s on `/resources/<hash>/login/lotties/dist/assets/...` mean the `resources/` tree is missing from the volume, or the ingress rewrites `/resources/`: forward `/resources/*` unchanged.
- **Fonts missing:** Fraunces ships in `resources/dist/assets` (woff2); check they are served with 200 and not blocked by a `font-src` CSP set at the ingress.
- **Edited files do not show:** Keycloak caches themes and templates; restart the pod, or (development only) start with `--spi-theme--cache-themes=false --spi-theme--cache-templates=false`.
- **Init container in `CrashLoopBackOff`:** image pull (secret), `sha256sum: FAILED` (route C), or a missing scratch `emptyDir` (`br-theme-dl` mounted at `/dl` in route C; the root filesystem is read-only).
- **Permission denied copying:** run the init container as 1001 (as in the files); `fsGroup: 1001` makes the `emptyDir` writable.

### Bitnami legacy images are frozen

`bitnamilegacy/keycloak` receives no updates (Bitnami moved its older images there and stopped maintaining them), so 26.0.5 gets no security fixes. A later migration to the official `quay.io/keycloak/keycloak` image is advisable and out of scope here; the directory-mode packages and carrier images work unchanged there, only the mount path changes (`/opt/keycloak/themes`).

### What was verified (local, throwaway, no cluster contact)

`deploy/verify-bitnami-local.sh` runs the real `docker.io/bitnamilegacy/keycloak:26.0.5-debian-12-r0` in podman as `br-kc-bn`: production mode (`KEYCLOAK_PRODUCTION=true`, proxy headers), `--read-only`, uid 1001, capabilities dropped, the chart's writable mounts as volumes, the theme mounted `:ro`. `verify-init-routes.sh A|C` fills the theme volume with the same commands and security context as the values files; `verify-multi.sh` checks the multi layout with two clients; `verify-bitnami-shots.mjs` (Playwright from `tests/e2e/node_modules`) writes `docs/design/screenshots/keycloak-bn-*.png`.

## Reverse proxy and TLS

Terminate TLS in front of the `web` container (Caddy, Traefik, nginx, a cloud load balancer) and forward to port 80 of the container. The inner nginx already forwards `Host` and `X-Forwarded-*` to the API. Requirements:

- Serve the app over HTTPS only; OIDC and the service worker require a secure context (localhost excepted).
- Set `Strict-Transport-Security: max-age=31536000; includeSubDomains` at the TLS proxy. It is documented but intentionally not set in `code/web/nginx.conf`, because the container speaks plain HTTP and HSTS over HTTP is ignored (and risky to ship before HTTPS works).
- Keep the `api` service unpublished (the compose file does not map its port).
- Request bodies up to 6 MB are allowed (CSV import); do not set a lower limit on the proxy.

The response headers set by the web container are a Content-Security-Policy (`default-src 'self'`, strict `script-src 'self'`, `connect-src 'self'` plus the OIDC origin, `frame-ancestors 'none'`), `X-Content-Type-Options`, `Referrer-Policy: no-referrer` and a minimal `Permissions-Policy`. `sw.js`, `manifest.webmanifest`, `manifest-dark.webmanifest` and `index.html` are served `no-cache` so updates are picked up; `/assets/*` is hashed and `immutable`.

## Push notifications

Optional, self-hosted Web Push (VAPID, RFC 8291). There is no third-party push vendor: the API sends dose-due and nap-window reminders (and Settings test sends) straight to the browser push services (FCM, Mozilla, Apple, Windows). Contract: `docs/SPEC.md` section "Push notifications".

### Enabling it

Push is on only when all three VAPID values are set; with none set the feature is off (`GET /api/v1/push/config` returns `enabled: false`, the web hides it, other push routes answer 409 `push_not_configured`). Setting only some of them, a key pair that does not match, or a bad subject fails startup.

| Variable / config key | Required | Purpose |
|----------|---------|---------|
| `PUSH_VAPID_PUBLIC_KEY` (`Push:Vapid:PublicKey`) | for push | Public key, base64url uncompressed P-256 (public, sent to browsers) |
| `PUSH_VAPID_PRIVATE_KEY` (`Push:Vapid:PrivateKey`) | for push | Private key, base64url. Secret: never commit or log it |
| `PUSH_VAPID_SUBJECT` (`Push:Vapid:Subject`) | for push | Operator contact, `mailto:you@example.com` or an `https:` URL |
| `Push__SchedulerEnabled` (`Push:SchedulerEnabled`) | no (`true`) | Runs the background reminder scheduler in this instance |
| `Push__TickSeconds` (`Push:TickSeconds`) | no (60) | Scheduler polling interval, 15 to 300 seconds |
| `Push__AllowedEndpointHosts__0..n` (`Push:AllowedEndpointHosts`) | no | Push service hosts the API may POST to (SSRF guard); empty = the built-in list in SPEC |
| `Push__MaxSubscriptionsPerUser` | no (10) | Active devices per user |
| `Push__SendTimeoutSeconds` | no (10) | HTTP timeout of one send |
| `Push__MaxConcurrentSends` | no (8) | Parallel sends per tick |

Only the three `PUSH_VAPID_*` names are flat aliases; the other settings use the standard .NET `Section__Key` environment form.

### Generating VAPID keys

```sh
dotnet BabyRoutine.Api.dll --generate-vapid-keys      # published API
dotnet run --project code/api/src/BabyRoutine.Api -- --generate-vapid-keys   # from source
```

It prints `PUSH_VAPID_PUBLIC_KEY=...` and `PUSH_VAPID_PRIVATE_KEY=...` to stdout and exits; it writes no file. Generate once per deployment and keep the pair: changing it invalidates every existing browser subscription (users must re-enable notifications on each device).

Keep the values in the gitignored root `.env` or a secret store, never in the repository. The compose `api` service must pass them through, e.g. add to its `environment:`:

```yaml
      PUSH_VAPID_PUBLIC_KEY: ${PUSH_VAPID_PUBLIC_KEY:-}
      PUSH_VAPID_PRIVATE_KEY: ${PUSH_VAPID_PRIVATE_KEY:-}
      PUSH_VAPID_SUBJECT: ${PUSH_VAPID_SUBJECT:-}
```

Kubernetes (placeholders only; create the real secret out of band, e.g. `kubectl create secret generic baby-routine-push --from-literal=...`):

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: baby-routine-push
type: Opaque
stringData:
  PUSH_VAPID_PUBLIC_KEY: "<public-key>"
  PUSH_VAPID_PRIVATE_KEY: "<private-key>"
  PUSH_VAPID_SUBJECT: "mailto:<operator@example.com>"
---
# in the API Deployment container spec:
#   envFrom:
#     - secretRef:
#         name: baby-routine-push
```

### Database

Apply the `PushNotifications` migration (`20261021182304_PushNotifications`, included in the idempotent `code/api/migrations/all.sql`) as the migrator role. It adds `push_subscriptions`, `user_notification_settings`, `baby_notification_preferences`, `notification_deliveries`, `notification_actions` and `job_leases`. Then make sure the app role can use them: if you set `ALTER DEFAULT PRIVILEGES` for the migrator (see "Database roles" and `docs/sql/grant-app-role.sql`) nothing else is needed; otherwise re-run the `GRANT ... ON ALL TABLES` / `ON ALL SEQUENCES` lines after the migration.

### Requirements and behaviour

- HTTPS is mandatory (service workers and the Push API need a secure context; localhost excepted).
- iOS/iPadOS (16.4+): push works only after the user adds the app to the home screen and opens it from there; in a Safari tab the option is unavailable.
- Single or multiple API instances: the scheduler takes a database lease (`job_leases`, valid for two ticks) so only one instance sends per tick; the others idle and take over if the holder stops. Claims are idempotent, so a duplicate reminder is not sent. You may set `Push__SchedulerEnabled=false` on instances that should never schedule; at least one must keep it on.
- Reverse proxy: nothing push-specific inbound. The anonymous `POST /api/v1/push/deliveries/{id}/actions` (notification snooze/dismiss from the service worker) must reach the API like any other `/api/` route. Outbound, the API needs HTTPS (443) egress to the push service hosts; an egress proxy or firewall must allow them. `sw.js` must stay `no-cache` (already set by `code/web/nginx.conf`).

### Verifying

1. Signed in, `GET /api/v1/push/config` returns `{"enabled": true, "publicKey": "..."}`.
2. In the app, Settings, Notifications: enable notifications on this device, then use the test send; the result shows `sent` per device and a notification appears.
3. API logs show the scheduler ticking (no endpoints, keys or payloads are logged).

### Troubleshooting

- Startup fails mentioning VAPID: one or two variables set, keys swapped or from different pairs, or subject not `mailto:`/`https:`. Set all three from one generated pair.
- `enabled: false`: the variables do not reach the API container (check the compose `environment:` / `envFrom`).
- 422 `push_endpoint_not_allowed` on subscribe: the browser's push host is not in `Push:AllowedEndpointHosts`.
- Test send `gone`: the browser dropped the subscription (or keys were rotated); re-enable on the device. `failed`: outbound network or push service error.
- Database errors on push routes (permission denied): the app role lacks grants on the new tables, see Database above.
- No reminders but test works: the user has no time zone saved (open Settings once), quiet hours, per-baby reminders off, or the scheduler disabled on every instance.

## Token storage trade-off

The OIDC library keeps the user, access token and refresh token in `localStorage`, which is required for offline use and silent renew in a pure SPA. Any script that runs on the page can read them, so the main mitigation is the CSP: no inline or eval scripts and no third-party script origins (`style-src 'unsafe-inline'` is allowed only because MUI/emotion injects styles). Further mitigations: refresh token rotation, short access token lifetimes, and a minimal dependency set (`npm audit` runs in CI). If your threat model needs more, put a backend-for-frontend with HttpOnly cookies in front instead.

## Database roles

The API does not run migrations itself. Apply the EF Core migrations with a separate, more privileged role and run the API with a limited role. The idempotent script is `code/api/migrations/all.sql`; tooling reads `DB_MIGRATOR_USER` / `DB_MIGRATOR_PASSWORD` (falling back to the app credentials) for `dotnet ef`.

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

-- Apply the schema as the migrator, e.g.:  psql -U baby_migrator -d babyroutine -f code/api/migrations/all.sql

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

## Podman

The stack is verified with Podman (6.x) and `podman-compose`; Docker is not required.

- Use `podman-compose up --build` (or `podman compose`) in place of `docker compose`. Image and `build:` syntax are the same.
- Podman builds OCI images by default, which drop the Dockerfile `HEALTHCHECK`; the API healthcheck is therefore also declared in `docker-compose.yml`. With plain `podman build`, add `--format docker` if you want the Dockerfile one.
- Short image names (`postgres:16`, `nginx`) resolve through your registries.conf; if prompted, choose docker.io or use fully qualified names.
- Rootful Podman inside WSL can fail creating bridge networks with `nftables error` (missing `nft` tables). Workarounds: install/enable nftables in the distro, run Podman rootless, or use `--network host` with a different host port for ad-hoc tests (port 80 may already be taken by another reverse proxy).
- What was checked by running the built images: nginx starts with the CSP rendered from `VITE_OIDC_AUTHORITY`, `/api/` is proxied to the API (unauthenticated `GET /api/v1/me` returns 401), `/assets/*` is immutable, `sw.js` and `index.html` are `no-cache`, SPA fallback works (`/invite` returns the app), the API runs as the non-root `app` user and its `/health` probe succeeds. Not checked: `podman-compose up` end to end with a real database and identity provider.

## Keycloak outgoing email (Brevo or any SMTP relay)

`code/keycloak-theme/deploy/configure-realm-smtp.sh` sets the realm's Email settings through the admin API (idempotent, `--dry-run` first). Credentials come from the environment only: `SMTP_HOST` (Brevo: `smtp-relay.brevo.com`), `SMTP_PORT` (587, STARTTLS), `SMTP_USER` (the SMTP login from Brevo's SMTP & API page), `SMTP_PASSWORD` (an SMTP key), `SMTP_FROM` (a sender on a domain verified with SPF and DKIM at the provider), plus the `KC_*` admin variables from `configure-realm.sh`. Set `REALM_VERIFY_EMAIL=1` to also require email verification for new users. Never put these values in the repo.
