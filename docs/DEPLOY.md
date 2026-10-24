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

Set `DB_HOST=postgres` and `POSTGRES_PASSWORD` (no default; the container refuses to start without it). The container creates the database `DB_NAME` (default `lotties`) and `DB_APP_USER` (compose default `lotties_app`, but the api requires it to be set) as superuser with that password, so set `DB_APP_PASSWORD` to the same value. Data lives in the named volume `pgdata`, the port is bound to `127.0.0.1:5432` only, and the api waits for the database healthcheck. Intended for local development, not production. Since `DB_APP_USER` is the superuser here, `DB_AUTO_MIGRATE=true` lets the api create the schema at startup (see [Applying migrations](#applying-migrations)).

## Environment variables

Compose reads `.env` from the repository root.

| Variable | Used by | Required | Purpose |
|----------|---------|----------|---------|
| `DB_HOST` | api | yes | Database host (`postgres` with `localdb`) |
| `DB_PORT` | api | no (5432) | Database port |
| `DB_NAME` | api, localdb | no (`lotties`) | Database name |
| `DB_APP_USER` | api, localdb | yes | Application role |
| `DB_APP_PASSWORD` | api | yes | Application role password |
| `DB_AUTO_MIGRATE` | api | no (`false`) | `true` applies pending migrations at startup; see "Applying migrations" |
| `DB_MIGRATOR_USER`, `DB_MIGRATOR_PASSWORD` | api (only with `DB_AUTO_MIGRATE`), `dotnet ef` | no (falls back to `DB_APP_*`) | Role with DDL rights that applies migrations |
| `POSTGRES_PASSWORD` | localdb | with `localdb` | Superuser password of the local container (no default) |
| `AUTH_AUTHORITY` | api | yes | OIDC issuer URL |
| `AUTH_AUDIENCE` | api | yes | API audience access tokens must carry |
| `AUTH_ADMIN_CLIENT_ID`, `AUTH_ADMIN_CLIENT_SECRET` | api | no (both or none; one alone stops the API at start) | Keycloak service account that may delete users in the realm; with it, account deletion also removes the sign-in account (see "Account deletion", docs/KEYCLOAK-ACCOUNT-DELETION.md). Secret: keep it with the other API secrets (home lab: `deploy/homelab/.env`, Secret `lotties-secrets`) |
| `CORS_ALLOWED_ORIGINS` | api | no | Comma-separated origins. Only if the web app is served from a different origin than the API, or for the iOS/Android app (`https://localhost,capacitor://localhost`, see "Native apps (iOS/Android)") |
| `FORWARDED_HEADERS_TRUSTED_NETWORKS` | api | no (private ranges) | CIDR list of proxies whose `X-Forwarded-For`/`-Proto` are applied; see "Reverse proxy and TLS" |
| `PUSH_VAPID_PUBLIC_KEY`, `PUSH_VAPID_PRIVATE_KEY`, `PUSH_VAPID_SUBJECT` | api | no (all or none) | Web Push; see "Push notifications" |
| `Alexa__Enabled`, `Alexa__SkillIds` | api | no (`false`) | The Alexa skill backend; see "Alexa skill" and docs/ALEXA.md |
| `Mcp__Enabled`, `Mcp__ResourceUrl`, `Mcp__Audience` | api | no (`false`) | The MCP server for AI assistants; see "MCP server" and docs/MCP.md |
| `Board__Enabled` | api | no (`false`) | The internal project board (owner + AI assistant; no baby data); see "Project board" and docs/KEYCLOAK-BOARD.md |
| `VITE_OIDC_AUTHORITY` | web build | yes | Issuer URL (same as `AUTH_AUTHORITY`); its origin is added to the CSP `connect-src` |
| `VITE_OIDC_CLIENT_ID` | web build | yes | Public SPA client id |
| `VITE_OIDC_AUDIENCE` | web build | no | Sent as the `audience` authorize parameter (Auth0) |
| `VITE_API_BASE_URL` | web build | no (empty) | Empty = same origin through nginx |
| `VITE_REPO_URL` | web build | no (empty) | Source repository link in the landing page footer (http/https only); empty hides it |
| `VITE_PRIVACY_CONTROLLER_NAME` | web build | before a store submission | The controller (person or company) the privacy policy names; empty = "the Lotties project maintainers". See "Privacy policy" |
| `VITE_PRIVACY_CONTACT_EMAIL` | web build | before a store submission | Contact address for privacy requests (a plain email, shown as a `mailto:` link); empty = the GitHub issue tracker and private reports |
| `VITE_PRIVACY_DPO` | web build | before a store submission | The encarregado (DPO) contact: a name, an email or both; empty = "the contact above" |
| `WEB_PORT` | compose | no (8080) | Host port of the web container |
| `OIDC_ORIGIN` | web runtime | no | Overrides the CSP OIDC origin derived from `VITE_OIDC_AUTHORITY` |
| `API_UPSTREAM` | web runtime | no (`api:8080`) | `host:port` nginx proxies `/api/` to; resolved per request, so nginx starts even when it does not exist |

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

#### Account deletion (Keycloak)

`DELETE /api/v1/me` erases the user's data in the database (docs/design/12-mobile-capacitor.md section 10). Removing the sign-in account at Keycloak needs a service account; the full steps, the test with a throwaway user and the rotation are in docs/KEYCLOAK-ACCOUNT-DELETION.md. In short: Clients, create a client `lotties-account-deletion` with client authentication **on**, only "Service accounts roles" ticked (standard flow, direct access grants off); Service account roles, assign the client role `realm-management` > `manage-users` (nothing else: Keycloak has no delete-only role); copy its secret into `AUTH_ADMIN_CLIENT_ID` / `AUTH_ADMIN_CLIENT_SECRET` (home lab: `deploy/homelab/.env`; `deploy.sh` puts both in the Secret `lotties-secrets`). The API only deletes the user whose token issuer is `AUTH_AUTHORITY`. Without them the data is still deleted, and the app says before the confirmation (`identityRemovable` in the preview) and after (`identity: not_configured`) that the sign-in account stays: remove it in the Keycloak admin console, Users. When Keycloak fails (`identity: failed`) the data is erased too, the API logs the Keycloak user id, and the user can sign in again and delete once more, or the owner deletes that user by hand.

### Authentik

1. Create an OAuth2/OpenID provider: client type **Public**, redirect URI `${origin}/auth/callback`, scope mappings `openid`, `profile`, `email` and `offline_access`, signing key set.
2. Add the provider to an application. The authority is the provider's issuer URL, `https://HOST/application/o/SLUG/`.
3. Set the audience to the client id (Authentik puts it in `aud`), and use it as `AUTH_AUDIENCE`. Post-logout redirect: `${origin}/login`.
4. Enable refresh token rotation if your version offers it; otherwise lower the refresh token validity.

### Native apps (iOS/Android)

The Capacitor shell in `code/mobile` bundles the web build and calls the production API from its own WebView origins; sign-in runs in the system browser and returns through the app's URL scheme. Only needed when the apps ship (full design: `docs/design/12-mobile-capacitor.md`):

- API: `CORS_ALLOWED_ORIGINS` also lists `https://localhost` (Android, `androidScheme: https`) and `capacitor://localhost` (iOS), e.g. `https://lotties.app,https://localhost,capacitor://localhost`. The home lab kit takes it from `deploy/homelab/.env`.
- Identity provider (same public client): valid redirect URI `app.lotties.app://auth/callback`, valid post logout redirect URI `app.lotties.app://auth/logout`, web origins `https://localhost` and `capacitor://localhost` (Keycloak answers the token and userinfo calls of the WebView with CORS for these origins).
- Native build values: `code/web/.env.native` (public, committed) plus `VITE_OIDC_CLIENT_ID` in `code/web/.env.native.local` or the shell; build with `npm --prefix code/mobile run build:web`.

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

Terminate TLS in front of the `web` container (Caddy, Traefik, nginx, a cloud load balancer) and forward to port 8080 of the container. The inner nginx already forwards `Host` and `X-Forwarded-*` to the API. Requirements:

- Serve the app over HTTPS only; OIDC and the service worker require a secure context (localhost excepted).
- Set `Strict-Transport-Security: max-age=31536000; includeSubDomains` at the TLS proxy. It is documented but intentionally not set in `code/web/nginx.conf`, because the container speaks plain HTTP and HSTS over HTTP is ignored (and risky to ship before HTTPS works).
- Keep the `api` service unpublished (the compose file does not map its port).
- Request bodies up to 6 MB are allowed (CSV import); do not set a lower limit on the proxy.

Client address: the API applies `X-Forwarded-For` and `X-Forwarded-Proto` (forwarded headers middleware, first in the pipeline) only when the connection comes from a trusted network, `FORWARDED_HEADERS_TRUSTED_NETWORKS` (config `ForwardedHeaders:TrustedNetworks`, comma-separated CIDR; empty or unset = `10.0.0.0/8,172.16.0.0/12,192.168.0.0/16`; loopback is always trusted; an entry that is not CIDR fails startup). Only the last `X-Forwarded-For` entry is used, the one the proxy appended, so a client cannot pick its own address. The per-address rate limit of the anonymous push action route and anything else that reads the remote address then see the client. Narrow the list (for example to the pod network) when other hosts in those ranges can reach the API directly.

The web image is `nginxinc/nginx-unprivileged` (uid 101, port 8080) and runs with a read-only root filesystem when `/tmp` and `/etc/nginx/conf.d` are writable (`emptyDir` or tmpfs with mode 0777). nginx resolves `API_UPSTREAM` per request through the nameservers of `/etc/resolv.conf` (`resolver`, no search domains), so a missing API host gives 502 on `/api/` instead of nginx refusing to start; use a name the DNS server answers as is (a compose service name or a cluster FQDN).

The response headers set by the web container are a Content-Security-Policy (`default-src 'self'`, strict `script-src 'self'` plus `'wasm-unsafe-eval'` for the cry monitor's WebAssembly (no JS eval, no inline scripts), `connect-src 'self'` plus the OIDC origin, `frame-ancestors 'none'`), `X-Content-Type-Options`, `Referrer-Policy: no-referrer` and a minimal `Permissions-Policy` (`microphone=(self)` for the opt-in cry monitor; camera, location, payment and USB off). `sw.js`, `manifest.webmanifest`, `manifest-dark.webmanifest` and `index.html` are served `no-cache` so updates are picked up; `/assets/*` is hashed and `immutable`; a missing file under `/models/` is a 404, never the app shell.

Cry monitor files (docs/design/35-cry-engine.md section 4): the web image carries the MediaPipe WASM (copied from the npm package by the Vite build) and the YAMNet model `models/cry/yamnet.tflite` (4.1 MB, Apache-2.0). The model is not in the repository: the web Dockerfile downloads it from MediaPipe's model storage with `node scripts/fetch-cry-model.mjs` and checks its pinned SHA-256, so the image build needs outbound HTTPS to `storage.googleapis.com` and stops with a clear message when the download or the checksum fails (the build then runs with `CRY_MODEL_REQUIRED=1`). A local `npm run build` without the file only warns; the app works and only the cry monitor reports `model_missing`. A reverse proxy in front must pass `/models/` through like any other static path.

## Home lab (Kubernetes + Traefik)

`deploy/homelab/` deploys the two images to the home lab cluster (context `home-lab-main`, namespace `lotties-app-production`, registry `cr.homel4b.dev/lotties`): one Helm chart for the API and the web releases, an Ingress on the external Traefik for `https://lotties.app` (`/api` to the API, the rest to the web app, certificate from cert-manager), the Secret `lotties-secrets` built from `deploy/homelab/.env`, and `DRY_RUN=1` to see the plan without changing anything. Prerequisites (Harbor project, pull Secret, Keycloak client settings), secrets rotation, migrations, verification and rollback: [deploy/homelab/README.md](../deploy/homelab/README.md).

### Versions

Every run of `deploy/homelab/deploy.sh` that builds an image is a release `vX.Y.Z` (the next patch after the git and
registry tags, or `VERSION`). The number is chosen **before** the builds (which images need a build is known first:
the source tag is not in the registry, or `FORCE_BUILD=1`, or a fixed `TAG`), so each image built in the run carries
it as build arguments, the same three for both:

| Build arg | Value | Web (code/web/Dockerfile -> ENV -> vite.config.ts / build-info.ts) | API (code/api/Dockerfile runtime stage -> ENV) |
| --- | --- | --- | --- |
| `APP_VERSION` | `X.Y.Z` (no v); empty without a release (a fixed `TAG` and no `VERSION`) | `__APP_VERSION__`, `dev` when empty | `GET /api/v1/version` `version`, `dev` when empty |
| `APP_COMMIT` | `git rev-parse --short=12 HEAD` of the checkout | `__APP_COMMIT__` | `commit` |
| `APP_BUILD_TIME` | UTC ISO time of the run | `__APP_BUILT_AT__` | `builtAt` |

The web app shows its own and the server's version in Hub > App > About and a short `v0.1.38` line in Settings, the
Hub, the landing footer, `/credits`, `/privacy` and the doctor's account menu. A local `npm run build` or `vite dev`
has no `APP_VERSION` and shows `dev` (the commit still comes from git).

**The version is never part of an image tag.** Tags stay `src-<hash>` of the git file list of each image's sources
(plus the web `VITE_*` values): the release number, the commit and the build time are left out on purpose, so a new
release does not rebuild or restart an unchanged image. The consequence: an image that is not rebuilt keeps the
release that built it. After a release that changed only the web app, About shows for example app v0.1.39 and server
v0.1.38; that is correct (the API did not change), and About adds only the neutral note "The server was updated
separately". The update hint ("An update is available" with Reload) never comes from comparing versions or commits: it
appears only when the service worker has a new app version installed and waiting (`pwa/updateStore.ts`, the same
signal as Hub > Check for updates). The `v0.1.39` and `latest` registry tags still point at both images of the
release. `deploy.test.sh` checks that both images get the release and that the tags do not depend on it.

To have both images carry the same release (one number in About), rebuild both in the release: `FORCE_BUILD=1
./deploy/homelab/deploy.sh`. Nothing else changes: the `src-<hash>` tags stay the same (they are pushed again with the
new stamp) and the pods restart.

Other ways to build the images (podman by hand, CI) pass the same three `--build-arg`s; without them the app and the
API say `dev`. The iOS/Android build (`npm --prefix code/mobile run build:web`) also needs `APP_VERSION` in its
environment to show a release instead of `dev`.

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
dotnet Lotties.Api.dll --generate-vapid-keys      # published API
dotnet run --project code/api/src/Lotties.Api -- --generate-vapid-keys   # from source
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

Apply the `PushNotifications` migration (`20261021182304_PushNotifications`) as the migrator role (see [Applying migrations](#applying-migrations)). It adds `push_subscriptions`, `user_notification_settings`, `baby_notification_preferences`, `notification_deliveries`, `notification_actions` and `job_leases`. Then make sure the app role can use them: if you set `ALTER DEFAULT PRIVILEGES` for the migrator (see "Database roles" and `docs/sql/grant-app-role.sql`) nothing else is needed; otherwise re-run the `GRANT ... ON ALL TABLES` / `ON ALL SEQUENCES` lines after the migration.

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

## Address lookup

The provider sheet's "Find address" calls `GET /api/v1/address/lookup` (Brazilian CEP: BrasilAPI, then ViaCEP) and `GET /api/v1/address/search` (OpenStreetMap Nominatim). The API is the proxy, so the browser calls no third party and the CSP is unchanged. No keys or accounts. Only the CEP digits or the search text the user typed leave the server (plus an identifying `User-Agent`); the typed text is never logged. Design: docs/design/23-address-lookup.md.

| Config key (env) | Default | Purpose |
|----------|---------|---------|
| `AddressLookup__Enabled` | `true` | `false` turns the feature off: the routes answer 503 `address_lookup_disabled` and nothing is called |
| `AddressLookup__ContactEmail` | empty | Operator e-mail added to the `User-Agent` (`Lotties-baby-tracker/1.0 (+repo; you@example.com)`), as the Nominatim policy asks; set it |
| `AddressLookup__BrasilApiBaseUrl`, `__ViaCepBaseUrl`, `__NominatimBaseUrl` | `https://brasilapi.com.br`, `https://viacep.com.br`, `https://nominatim.openstreetmap.org` | Upstream bases (absolute http(s), no query). Point `NominatimBaseUrl` at your own instance for more than light use: the public one allows 1 request per second and may block abuse |
| `AddressLookup__TimeoutSeconds` | `5` | Timeout of each upstream call (also how long a search waits for its Nominatim slot) |
| `AddressLookup__CepCacheMinutes`, `__SearchCacheMinutes` | `1440`, `60` | In-memory cache lifetime of CEP answers (not found included) and search answers |
| `AddressLookup__CacheMaxEntries` | `1000` | Cached answers per kind; emptied when full |
| `AddressLookup__NominatimMinIntervalMilliseconds` | `1100` | Least time between two Nominatim requests of this server (0 only for a private instance) |
| `RequestLimits__AddressLookupPermitsPerMinute` | `20` | Lookups per user per minute (both routes; 429 `rate_limited`) |

Invalid values fail startup. Egress: the API pod must reach `brasilapi.com.br`, `viacep.com.br` and `nominatim.openstreetmap.org` over HTTPS (or your replacements); if it cannot, the feature answers 502 and the address field stays manual. Keep the log level of `System.Net.Http.HttpClient.AddressLookup` at `None` (set in `appsettings.json`: a higher level would print request URLs, i.e. the typed text). A reverse proxy's access log may record the query string of `/api/v1/address/*`; exclude that path from the log if you do not want it kept.

## Alexa skill

`POST /api/v1/alexa` is the backend of the Lotties Alexa custom skill (docs/design/32-assistants.md); the owner's setup
(developer console, Keycloak account-linking client, certification) is [docs/ALEXA.md](ALEXA.md). Off by default: the
route answers 404. It needs migration `VoiceAssistants` (table `user_assistant_settings`). No secret is configured
here: the account-linking client secret lives only in Keycloak and the Alexa console.

| Config key (env) | Default | Purpose |
|----------|---------|---------|
| `Alexa__Enabled` | `false` | `true` answers Alexa requests (startup fails without a valid skill id) |
| `Alexa__SkillIds` | empty | Skill ids (`amzn1.ask.skill.<uuid>`) whose requests are answered: one comma-separated value, or `Alexa__SkillIds__0`, `__1`, ... |
| `Alexa__CertCacheMinutes` | `60` | How long Amazon's downloaded signing certificate chain is reused (1-1440; never past its expiry) |
| `Alexa__CertDownloadTimeoutSeconds` | `5` | Timeout of that download (1-30) |
| `Alexa__CertMaxBytes` | `65536` | Largest certificate chain accepted (1024-1048576) |
| `Alexa__MaxRequestBodyBytes` | `131072` | Largest request body (1024-1048576; larger is 413) |
| `RequestLimits__AssistantPermitsPerMinute` | `30` | Voice commands per linked user per minute (over it the skill says to try again) |

Egress: the API pod must reach `https://s3.amazonaws.com` (path `/echo.api/...`, Amazon's request-signing certificate);
nothing else of Amazon is called. Access tokens from account linking are validated with `AUTH_AUTHORITY` /
`AUTH_AUDIENCE` like every other token, so the Keycloak client of the skill needs the same `lotties-api` audience mapper
as the SPA client. Logs carry the intent name, the result code and the correlation id only.

## MCP server

`POST /api/v1/mcp` is a remote MCP server for AI assistants such as Claude (docs/design/32-assistants.md section 9); the
owner's setup (Keycloak client scopes `lotties.read`/`lotties.write` with consent texts, the audience mapper, the AI
clients, Claude, the MCP Inspector, revoking) is [docs/MCP.md](MCP.md). Off by default: every MCP route, the protected
resource metadata included, answers 404. No migration and no secret: the API only validates the tokens Keycloak issues to
the AI clients.

| Config key (env) | Default | Purpose |
|----------|---------|---------|
| `Mcp__Enabled` | `false` | `true` serves the MCP endpoint and its OAuth metadata (startup fails without `AUTH_AUTHORITY`) |
| `Mcp__ResourceUrl` | empty (derived from the request) | The canonical MCP URL, e.g. `https://lotties.app/api/v1/mcp`: the metadata's `resource`, the URL Settings shows (absolute http(s), no query or fragment) |
| `Mcp__Audience` | `lotties-mcp` | The `aud` MCP tokens must carry (Keycloak's audience mapper on the two client scopes; docs/MCP.md recommends the MCP URL). Must differ from `AUTH_AUDIENCE` (startup fails otherwise) |
| `Mcp__AllowedOrigins` | empty | Browser origins allowed to call the endpoint (comma-separated, or `__0`, `__1`, ...); any other `Origin` is 403. Server-side clients send none; set it only for a browser-based test client |
| `Mcp__MaxRequestBodyBytes` | `65536` | Largest request body (1024-1048576; larger is 413) |
| `RequestLimits__AssistantPermitsPerMinute` | `30` | Tool calls (and voice commands) per user per minute; over it a tool answers `rate_limited` |

The ingress sends `/.well-known/oauth-protected-resource` (RFC 9728, with the path-suffixed
`/.well-known/oauth-protected-resource/api/v1/mcp`) to the API next to `/api` (deploy/homelab/manifests/ingress.yaml);
another reverse proxy needs the same route. Keycloak must be reachable from the AI provider's servers (Anthropic publishes
its egress range). Logs carry the tool name, the result code and the correlation id only; the SDK's own log categories
(`ModelContextProtocol*`) are kept at Warning in code.

## Project board

`/api/v1/board` is the internal project board (docs/design/36-project-board.md): tasks, gaps, decisions, questions,
risks, notes and memories that the owner and the AI assistant track together. It holds **no baby data**, calls no third
party and lives in the same database (and the same `pg_dump` backups). Off by default: every route answers 404. It needs
migration `ProjectBoard` (tables `board_topics` with ten seeded topics, `board_items`, `board_item_events`,
`board_api_keys`). No secret is configured: people get in with Keycloak realm roles, tools with board API keys that a
board admin creates in the app (only their SHA-256 is stored). The owner's steps (the three realm roles, the
`realm_access.roles` mapper of the `roles` client scope, assigning roles, the first API key with `curl`, revoking) are in
[docs/KEYCLOAK-BOARD.md](KEYCLOAK-BOARD.md).

| Config key (env) | Default | Purpose |
|----------|---------|---------|
| `Board__Enabled` | `false` | `true` serves the board routes (the home lab kit does not set it: add it under `env:` in `deploy/homelab/values/api.yaml`) |
| `RequestLimits__BoardPermitsPerMinute` | `120` | Board requests per user or per API key per minute (the global 300 per user still applies) |
| `RequestLimits__BoardMaxRequestBodyBytes` | `262144` | Largest board request body (413 above) |
| `RequestLimits__BoardBulkMaxRequestBodyBytes` | `4194304` | Largest bulk import body (`POST /board/items/bulk`, up to 100 items) |

Keycloak in short: **Realm roles > Create role** `lotties-board-reader`, `lotties-board-writer`, `lotties-board-admin`;
**Client scopes > roles > Mappers > realm roles** with Token Claim Name `realm_access.roles` and "Add to access token" on
(Keycloak's default), the `roles` scope a Default scope of the web app's client; **Users > the person > Role mapping >
Assign role** (Filter by realm roles). Then an admin creates a key (`POST /api/v1/board/keys`, the secret is shown once)
and the assistant sends it as `X-Board-Key` or `Authorization: Bearer lbk_...`:

```bash
curl -s https://lotties.app/api/v1/board/summary -H "X-Board-Key: $LOTTIES_BOARD_KEY"
```

Logs carry item and key ids, the actor kind and result codes only (never a secret, a title or a body). CORS is the app's
(no board-specific origin).

## Privacy policy

The public policy is the web route `/privacy` (https://lotties.app/privacy; also Hub > Privacy policy and
`/doctor/privacy`). Its text is in `code/web/src/legal/privacy.en.ts` and `privacy.pt-BR.ts`, the facts behind it in
`docs/design/33-privacy-audit.md`, and what the owner must still decide in `docs/PRIVACY-OWNER-CHECKLIST.md`. Three
public build values name who is responsible; they are contact details the owner chooses to publish, never secrets:

| Variable | Shown as | Default when empty |
|----------|----------|--------------------|
| `VITE_PRIVACY_CONTROLLER_NAME` | the controller ("Responsible for that data") | "the Lotties project maintainers" |
| `VITE_PRIVACY_CONTACT_EMAIL` | the contact, as a `mailto:` link (a plain address only; anything else is ignored) | the repository's issue tracker for questions and a private GitHub report for anything personal |
| `VITE_PRIVACY_DPO` | the encarregado (data protection contact) | "the contact above" |

A value that is empty, a `<placeholder>`, longer than 200 characters or has control characters falls back to the
default, so the page never shows a marker. They reach the bundle like `VITE_REPO_URL`: `docker-compose.yml` build
args, the web `Dockerfile`, `deploy/homelab/deploy.sh` (from `deploy/homelab/.env`; a changed value rebuilds the web
image) and, for the iOS/Android build, `code/web/.env.native.local`. Change them with a new web build. Keeping the
policy honest: every change that adds a data flow or a third party updates the policy content and the audit
(`CLAUDE.md`).

Operational facts the policy relies on (check them when the setup changes): the API logs no IP addresses, request
lines or record content; the web container's nginx keeps its stock access log (client address from
`X-Forwarded-For`, path, user agent); a reverse proxy's access log may record the query string of
`/api/v1/address/*` (the address search text), so exclude that path there if you do not want it kept; HSTS is not
set yet (see "Reverse proxy and TLS").

## Token storage trade-off

The OIDC library keeps the user, access token and refresh token in `localStorage`, which is required for offline use and silent renew in a pure SPA. Any script that runs on the page can read them, so the main mitigation is the CSP: no inline or eval scripts and no third-party script origins (`style-src 'unsafe-inline'` is allowed only because MUI/emotion injects styles). Further mitigations: refresh token rotation, short access token lifetimes, and a minimal dependency set (`npm audit` runs in CI). If your threat model needs more, put a backend-for-frontend with HttpOnly cookies in front instead.

## Database roles

Apply the EF Core migrations with a separate, more privileged role and run the API with a limited role. By default the API does not run migrations itself; see [Applying migrations](#applying-migrations) for the supported ways. Migration tooling reads `DB_MIGRATOR_USER` / `DB_MIGRATOR_PASSWORD` (falling back to the app credentials).

```sql
-- Run as a database administrator. Replace the placeholders; use generated passwords.
CREATE ROLE lotties_migrator LOGIN PASSWORD '<generated-migrator-password>';
CREATE ROLE lotties_app      LOGIN PASSWORD '<generated-app-password>';

CREATE DATABASE lotties OWNER lotties_migrator;
REVOKE ALL ON DATABASE lotties FROM PUBLIC;
GRANT CONNECT ON DATABASE lotties TO lotties_app;

\c lotties
-- The migrator owns the schema objects it creates.
ALTER SCHEMA public OWNER TO lotties_migrator;
GRANT USAGE ON SCHEMA public TO lotties_app;

-- Apply the schema as the migrator (see "Applying migrations": dotnet ef, DB_AUTO_MIGRATE, or a generated script).

-- Run once after the migration, and again after each migration that adds tables:
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO lotties_app;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO lotties_app;

-- Or make it automatic for objects the migrator creates later:
ALTER DEFAULT PRIVILEGES FOR ROLE lotties_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO lotties_app;
ALTER DEFAULT PRIVILEGES FOR ROLE lotties_migrator IN SCHEMA public
  GRANT USAGE ON SEQUENCES TO lotties_app;
```

Put `lotties_app` in `DB_APP_USER` / `DB_APP_PASSWORD`. Never give the migrator credentials to the running API container, unless you deliberately opt in to `DB_AUTO_MIGRATE` (below). The same grants are in `docs/sql/grant-app-role.sql`.

### Applying migrations

The migrations are the EF Core code-first migrations in `code/api/src/Lotties.Infrastructure/Persistence/Migrations/`. There is no checked-in SQL script. Supported ways, in order of preference for production:

**Dedicated migrator role.** A separate non-superuser role can run the migrations (`dotnet ef database update` or `DB_AUTO_MIGRATE=true`) if it owns the tables and may create objects in the schema. `docs/sql/grant-migrator-role.sql` sets that up once, as an admin, and is idempotent: it makes the role the owner of the existing tables, gives it `CREATE` on the schema, and sets the API role's default privileges for tables the migrator creates. Never make the migrator a member of a superuser role.

1. **`dotnet ef` (recommended, the default).** Run as the migrator role, from `code/api`, using the local tool manifest (`dotnet-tools.json`, `dotnet-ef` 8.0.32):

   ```bash
   cd code/api
   dotnet tool restore
   DB_HOST=... DB_PORT=5432 DB_NAME=lotties DB_MIGRATOR_USER=lotties_migrator DB_MIGRATOR_PASSWORD=... \
     dotnet ef database update --project src/Lotties.Infrastructure
   ```

   The design-time factory reads `DB_HOST`, `DB_PORT`, `DB_NAME` and `DB_MIGRATOR_USER` / `DB_MIGRATOR_PASSWORD` (falling back to `DB_APP_*`).

2. **SQL for a DBA.** Generate the idempotent script on demand and review/apply it with `psql` as the migrator (do not commit the output):

   ```bash
   cd code/api
   dotnet tool restore
   dotnet ef migrations script --idempotent --project src/Lotties.Infrastructure -o out.sql
   psql -U lotties_migrator -d lotties -f out.sql
   ```

3. **`DB_AUTO_MIGRATE=true` (opt-in, for development and self-hosting convenience).** The API applies pending migrations at startup, after the host is built and before it serves requests or starts the push scheduler. It is off by default; accepted values are `true`/`false` (any case) and `1`/`0`, anything else fails startup.
   - It connects with a separate connection built from `DB_MIGRATOR_USER` / `DB_MIGRATOR_PASSWORD` (falling back to `DB_APP_*`, like `dotnet ef`); request handling keeps using the limited app role. The migrator role needs DDL rights (owner of the schema, as in "Database roles"), and the app role gets its privileges from `ALTER DEFAULT PRIVILEGES` (see `docs/sql/grant-app-role.sql`). This means the API container holds the migrator credentials, which is why it is not the production default.
   - Several instances starting together are serialized by a PostgreSQL session advisory lock (`pg_try_advisory_lock`, fixed key) on the migrator connection: one migrates, the others wait (polling every second, up to 5 minutes) and then find nothing pending. Waiting longer fails startup.
   - The log lists the pending migration names, the result and the duration; connection strings and passwords are never logged. Any failure (connection, lock timeout, migration error) is logged as critical and stops startup, so the API never serves a half-migrated schema.
   - It is skipped when the runtime database is not PostgreSQL (the SQLite integration-test host creates its schema itself).

Do not use `EnsureCreated()` against a real database: it creates the tables without the `__EFMigrationsHistory` table, after which migrations can no longer be applied.

#### Migrations that seed built-in event types

Built-in event types are rows in `event_types` (with `baby_id` null) inserted by migrations, and clients only learn about them from `GET /babies/{id}/event-types`. Until the migration is applied the API does not serve the type, so phones show neither its tile nor its form, and the API rejects events that reference the new type id.

- `NasalSuction` (`20261022000952_NasalSuction`): adds the built-in `nasal_suction` type (Nasal suction / Aspiração nasal, instant, optional `tool` and `saline`). Seed only: one insert, no table changes, no event rewrites, no new grants. Apply it with `dotnet ef database update` (option 1 above) or let `DB_AUTO_MIGRATE=true` apply it at startup, **before** deploying the web build that offers the Nasal suction preset; the preset stays hidden until the type is served.
- `BellyMassage` (`20261022011434_BellyMassage`, after `PrescriptionDayParts`): adds the built-in `belly_massage` type (Belly massage / Massagem na barriguinha, timed, optional `reason` and `helped`, plus the hidden pause keys). Seed only: one insert, no table changes, no event rewrites, no new grants. Apply it with `dotnet ef database update` (option 1 above) or let `DB_AUTO_MIGRATE=true` apply it at startup, **before** deploying the web build that offers the Belly massage preset; the preset stays hidden until the type is served.
- `FussyEvent` (`20261022020422_FussyEvent`, after `BellyPainPattern`): adds the built-in `fussy` type (Fussy / crying / Choro / irritação, timed, optional `intensity` and `what_helped`, plus the hidden pause keys). Seed only: one insert, no table changes, no event rewrites, no new grants. Apply it **before** deploying the web build that offers the Fussy preset; the preset stays hidden until the type is served.
- `MoreEventTypes` (`20261022213633_MoreEventTypes`, after `DoctorProposals`): adds eight built-in types (`nail_trim`, `temperature`, `spit_up`, `teething`, `milestone`, `symptom`, `outdoor`, `skin_care`). Seed only: one insert of eight rows, no table changes, no event rewrites, no new grants. The temperature field uses the new optional `decimals` member of the field JSON; an older API build would read that field without its one-decimal limit, so deploy the API build of this change with the migration. It is applied at the next deploy like the others (`dotnet ef database update` or `DB_AUTO_MIGRATE=true`), **before** the web build that offers the eight presets; each preset stays hidden until its type is served.

#### Migrations of the notification preferences

- `BellyPainPattern` (`20261022014026_BellyPainPattern`) and `FussyAndOvertiredPrefs` (`20261022021117_FussyAndOvertiredPrefs`, right after `FussyEvent`): add `baby_notification_preferences.belly_pain_pattern`, then `overtired_warning` and `fussy_pattern` (all `boolean NOT NULL DEFAULT FALSE`, so stored rows stay valid with the new kinds off) and recreate the scheduler's filtered candidate index `ix_baby_notification_preferences_baby_id` with the wider filter (dropped and created again inside the migration; no data is dropped or rewritten, no new grants). Apply them with the API that sends the new kinds; until then the API keeps working on the old columns. From this API version `PUT /babies/{id}/notification-preferences` merges (an omitted field keeps its stored value), so an older web build still in a browser cache can no longer turn off a kind it does not know.
- `DiaperHeadsUpPrefs` (`20261022045238_DiaperHeadsUpPrefs`, right after `FussyAndOvertiredPrefs`): adds `baby_notification_preferences.diaper_wet_headsup` and `diaper_dirty_headsup` (`boolean NOT NULL DEFAULT FALSE`, the heads-ups stay off for stored rows) and recreates `ix_baby_notification_preferences_baby_id` with the filter widened to them (dropped and created again inside the migration; no data dropped or rewritten, no new grants). Apply it with `dotnet ef database update` (or `DB_AUTO_MIGRATE=true`) together with the API that plans `diaper_wet_headsup` / `diaper_dirty_headsup`; the predictions' `diaper` part needs no migration. An older web build keeps working: it does not send the new fields, and the merge keeps them.

## Medicine catalog (ANVISA official list)

The shared catalog can be filled with Brazil's registered medicines (brand names, forms and active ingredients) from ANVISA's open data, plus a small curated list (`code/api/tools/Lotties.CatalogImporter/Data/curated-products.json`, not reviewed by a pharmacist), by the admin tool `code/api/tools/Lotties.CatalogImporter` (design, licence, mapping and safety rules: [docs/design/13-anvisa-catalog.md](design/13-anvisa-catalog.md)). It is optional: the app works without it.

1. Apply the migration `ProductExternalRef` (`20261022143647_ProductExternalRef`, right after `DiaperHeadsUpPrefs`) with the API version that ships it, like any other migration (see [Applying migrations](#applying-migrations)). It only adds nullable columns to `products` (`source`, `external_ref`, `presentation`, `ambiguous_name`, `inactive_since`) and the partial unique index `ix_products_source_external_ref`; no data is rewritten and no grant is needed.
2. Run the importer from a machine that can reach the database (an admin workstation through a VPN or port-forward, or a one-off job). Never from inside the API pod: the pod has no SDK and must not download files. It needs the .NET 8 SDK and outbound HTTPS to `dados.anvisa.gov.br` (or the two CSV files copied to that machine).
3. Dry run first (no database connection): `dotnet run --project code/api/tools/Lotties.CatalogImporter -- --dry-run --lookup "Luftal,Simeticona"`. Check the counts and the spot checks.
4. Real run, with the same variables as the API: `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_APP_USER`, `DB_APP_PASSWORD` (the app role has `SELECT, INSERT, UPDATE, DELETE` on all tables, which is enough), or `--use-migrator` to connect with `DB_MIGRATOR_USER`/`DB_MIGRATOR_PASSWORD` instead: `dotnet run --project code/api/tools/Lotties.CatalogImporter`. Set the variables in the shell (for example from a password manager), never on the command line or in a committed file; the tool prints the host and database name, never the user or password. One transaction; about 20 s for the full list (8,880 official + 7 curated products) on a local database; re-running changes only what changed in the sources. The curated list ships next to the tool (`--curated <path|none>` to change or skip it).
5. Strengths (migration `ProductStrength`, `20261023162441_ProductStrength`, right after `AccountDeletion`): apply it with the API version that ships it (two nullable columns on `products`, `strength_key` and `strength_text`; no backfill; old pods ignore them). Until the importer runs again every strength is NULL and the "same active ingredient" list shows each alternative as "strength not known" (neutral, search unchanged). Rollout order: (a) deploy the API; (b) the owner, from the admin machine, runs the dry run and then the real run, both reading the cached files (use `--refresh` only if the cache is old): `dotnet run --project code/api/tools/Lotties.CatalogImporter -- --dry-run`, check the lines "CMED presentations whose strength reads as one unambiguous amount" and "products with a structured strength key", then `dotnet run --project code/api/tools/Lotties.CatalogImporter` with the `DB_*` variables set in the shell. The second run updates the products whose strength changed and the six curated ones; nothing else changes. The agent never runs these.
6. Refresh monthly (ANVISA updates the registrations monthly, the CMED price list about monthly) with the same command plus `--refresh` to download again. Products that left the list are marked inactive (hidden from search, still readable for linked medications), never deleted. The downloads live in `--cache-dir` (default `<temp>/lotties-anvisa-cache`), never in the repository.

## Podman

The stack is verified with Podman (6.x) and `podman-compose`; Docker is not required.

- Use `podman-compose up --build` (or `podman compose`) in place of `docker compose`. Image and `build:` syntax are the same.
- Podman builds OCI images by default, which drop the Dockerfile `HEALTHCHECK`; the API healthcheck is therefore also declared in `docker-compose.yml`. With plain `podman build`, add `--format docker` if you want the Dockerfile one.
- Short image names (`postgres:16`, `nginx`) resolve through your registries.conf; if prompted, choose docker.io or use fully qualified names.
- Rootful Podman inside WSL can fail creating bridge networks with `nftables error` (missing `nft` tables). Workarounds: install/enable nftables in the distro, run Podman rootless, or use `--network host` with a different host port for ad-hoc tests (port 80 may already be taken by another reverse proxy).
- The unprivileged web image was run like the Kubernetes pod (`--read-only --user 101`, tmpfs `/tmp` and `/etc/nginx/conf.d` with `mode=0777,notmpcopyup`, `--cap-drop ALL`, `--network host`): it starts with the default `API_UPSTREAM=api:8080` and no such host (502 on `/api/`, the rest served), proxies `/api/` to `API_UPSTREAM`, and keeps the CSP, `no-cache` on `/`, `sw.js`, `manifest.webmanifest` and the SPA fallback, `immutable` on `/assets/*`. Podman's default `--tmpfs` is not writable for uid 101 (root-owned, copied up), unlike an `emptyDir`.
- What was checked by running the built images: nginx starts with the CSP rendered from `VITE_OIDC_AUTHORITY`, `/api/` is proxied to the API (unauthenticated `GET /api/v1/me` returns 401), `/assets/*` is immutable, `sw.js` and `index.html` are `no-cache`, SPA fallback works (`/invite` returns the app), the API runs as the non-root `app` user and its `/health` probe succeeds. Not checked: `podman-compose up` end to end with a real database and identity provider.

## Keycloak outgoing email (Brevo or any SMTP relay)

`code/keycloak-theme/deploy/configure-realm-smtp.sh` sets the realm's Email settings through the admin API (idempotent, `--dry-run` first). Credentials come from the environment only: `SMTP_HOST` (Brevo: `smtp-relay.brevo.com`), `SMTP_PORT` (587, STARTTLS), `SMTP_USER` (the SMTP login from Brevo's SMTP & API page), `SMTP_PASSWORD` (an SMTP key), `SMTP_FROM` (a sender on a domain verified with SPF and DKIM at the provider), plus the `KC_*` admin variables from `configure-realm.sh`. Set `REALM_VERIFY_EMAIL=1` to also require email verification for new users. Never put these values in the repo.
