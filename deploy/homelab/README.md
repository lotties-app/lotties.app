# Home lab deployment

Runs Lotties in the home lab Kubernetes cluster. A script builds and pushes the two images, Helm installs the two
workloads, and one Ingress on the external Traefik makes them public at **https://lotties.app**.

- **Kube context:** `home-lab-main` (the script always passes it; `KUBECONFIG=~/.kube/home-lab.yaml` works too).
- **Namespace:** `lotties-app-production` (cluster convention `<domain>-<env>`; `NS` overrides it). Created when missing, labelled `app.kubernetes.io/part-of=lotties`.
- **Registry:** `cr.homel4b.dev/lotties` (Harbor project `lotties`).
- **Script:** [deploy.sh](deploy.sh), run as root in WSL. [deploy.test.sh](deploy.test.sh) checks it without a cluster.

## What runs

| Workload | Image | Release (one chart) | Notes |
| --- | --- | --- | --- |
| API (.NET 10) | `lotties-api` from `code/api/Dockerfile` | `lotties-api` | port 8080, uid 1654, probes on `/health`, config from env and the Secret `lotties-secrets` |
| Web app (React SPA, nginx-unprivileged) | `lotties-web` from `code/web/Dockerfile` | `lotties-web` | port 8080, uid 101, OIDC settings baked in at build time |

Both use [charts/lotties-app](charts/lotties-app) with a values file each in [values](values): non-root, read-only
root filesystem (`/tmp` and, for nginx, `/etc/nginx/conf.d` are `emptyDir`s), all capabilities dropped, seccomp
`RuntimeDefault`, no service account token, rolling updates (`maxUnavailable: 0`, `maxSurge: 1`), requests and a
memory limit. The database is external (PostgreSQL, not deployed here).

## How it is exposed

One Ingress ([manifests/ingress.yaml](manifests/ingress.yaml)), class `traefik-external`, host `lotties.app`:

| Address | Goes to |
| --- | --- |
| `https://lotties.app/api/...` | Service `lotties-api:8080`, path kept (the API routes start with `/api/v1`) |
| `https://lotties.app/...` | Service `lotties-web:8080` (the SPA, its service worker and manifests) |

- TLS: cert-manager issues the certificate into the Secret `lotties-tls` from the ClusterIssuer
  `letsencrypt-production-lotties-app-issuer` (DNS-01 in Cloudflare). Plain HTTP is redirected to HTTPS by Traefik.
- The browser talks to one origin, so no CORS is needed (`CORS_ALLOWED_ORIGINS` defaults to `https://lotties.app`).
  The iOS/Android app ([code/mobile](../../code/mobile), [docs/design/12-mobile-capacitor.md](../../docs/design/12-mobile-capacitor.md))
  runs its bundled copy of the web app from its own origins, so before it ships set in `deploy/homelab/.env`:
  `CORS_ALLOWED_ORIGINS=https://lotties.app,https://localhost,capacitor://localhost` (Android WebView, iOS WKWebView).
- nginx never sees `/api` in the cluster. Its `API_UPSTREAM` points at `lotties-api.<ns>.svc.cluster.local:8080`, so
  `kubectl port-forward svc/lotties-web 8080:8080` serves the whole app.
- The API trusts `X-Forwarded-For`/`-Proto` only from private networks (default `10.0.0.0/8,172.16.0.0/12,192.168.0.0/16`,
  `FORWARDED_HEADERS_TRUSTED_NETWORKS` overrides it) and only the last entry, the one Traefik appended.
- `PUBLIC_HOST`, `INGRESS_CLASS`, `CLUSTER_ISSUER` (empty: no certificate annotation) and `TLS_SECRET` are settings.

## Before the first run

1. **Harbor:** the project `lotties` exists, a robot account can push to it, and the cluster's pull robot (the one in
   the Secret `cr-homel4b` of namespace `keycloak`) can pull from it.
2. **Registry login** in WSL, as root: `podman login cr.homel4b.dev`.
3. **Pull Secret** `cr-homel4b` in the namespace: the script checks it. When it is missing it copies it from namespace
   `keycloak` with `COPY_PULL_SECRET=1` (or after a yes when run interactively). By hand (prints no secret):

   ```bash
   kubectl --context home-lab-main -n keycloak get secret cr-homel4b -o jsonpath='{.data.\.dockerconfigjson}' | base64 -d \
     | kubectl --context home-lab-main -n lotties-app-production create secret docker-registry cr-homel4b --from-file=.dockerconfigjson=/dev/stdin
   ```

4. **DNS:** `lotties.app` resolves to the external Traefik entry (already arranged; nothing to do here).
5. **Database:** database `lotties` with the app role `k_lotties_usr` (grants as in
   [docs/DEPLOY.md "Database roles"](../../docs/DEPLOY.md#database-roles)) and the schema migrated (see Migrations).
6. **Keycloak** (realm `lotties.app` at `https://auth.lotties.app`, issuer `https://auth.lotties.app/realms/lotties.app`),
   on the SPA client named in `VITE_OIDC_CLIENT_ID` (public client, standard flow with PKCE):
   - Valid redirect URIs: `https://lotties.app/auth/callback`
   - Valid post logout redirect URIs: `https://lotties.app/login`
   - Web origins: `https://lotties.app`
   - An audience mapper that adds `lotties-api` (the API's `AUTH_AUDIENCE`) to the access token.
   - For the iOS/Android app, on the same client (only when it ships; the web app does not need them):
     valid redirect URI `app.lotties.app://auth/callback`, valid post logout redirect URI `app.lotties.app://auth/logout`,
     Web origins `https://localhost` and `capacitor://localhost`. See
     [docs/design/12-mobile-capacitor.md section 4](../../docs/design/12-mobile-capacitor.md#4-keycloak-client-changes-owner).
7. **Settings:** copy [.env.example](.env.example) to `deploy/homelab/.env` (gitignored; `chmod 600`) and fill it in.
   The repository root `.env` (docker compose) is not used.

## Deploy

```bash
DRY_RUN=1 ./deploy/homelab/deploy.sh   # changes nothing: read-only checks, the plan, rendered manifests (kubectl client dry run)
./deploy/homelab/deploy.sh
```

What it does: checks the context, the cluster and the registry login, and every setting (before anything is changed);
creates the namespace when missing; checks (or copies) `cr-homel4b`; builds and pushes what changed; applies the Secret
`lotties-secrets`; installs `lotties-api` then `lotties-web` with `helm upgrade --install --wait`; applies the Ingress.

Images are tagged `src-<hash>` of the files they are built from (for the web image also the `VITE_*` values, so a
changed client id rebuilds it). A tag already in the registry is not rebuilt and its pods are not restarted. A run that
built something is a release: the images also get `vX.Y.Z` (the next patch after the git and registry tags, or
`VERSION`) and `latest`. `TAG`, `FORCE_BUILD=1` (also to pick up patched base images) and `SKIP_BUILD=1` are available. After a release the script creates the annotated git tag `vX.Y.Z` on HEAD and pushes it to `origin` (a problem is printed and never fails the deploy; `TAG_RELEASE=0` skips it, `PUSH_TAG=0` keeps it local).
The release is chosen before the builds and stamped into the images it builds (`APP_VERSION`, `APP_COMMIT`,
`APP_BUILD_TIME`; About and `GET /api/v1/version` show it); it is not part of the `src-<hash>` tag, so an image that
is not rebuilt keeps the release that built it (docs/DEPLOY.md "Versions").

## Secrets and rotation

- `lotties-secrets` holds `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_APP_USER`, `DB_APP_PASSWORD`, and when set
  `PUSH_VAPID_PUBLIC_KEY`/`PRIVATE_KEY`/`SUBJECT` (all three or none: none turns push off),
  `AUTH_ADMIN_CLIENT_ID`/`AUTH_ADMIN_CLIENT_SECRET` (both or none: with none, deleting an account in the app keeps the
  Keycloak user; setup and rotation in docs/KEYCLOAK-ACCOUNT-DELETION.md) and, only with `DB_AUTO_MIGRATE=true`,
  `DB_MIGRATOR_USER`/`DB_MIGRATOR_PASSWORD`.
- Values come from `deploy/homelab/.env`; a key not set there keeps what the Secret already has, a key set to an empty
  value is removed. The script writes each value to a file in a private temporary directory and builds the Secret from
  those files (server-side apply): values never appear on a command line or in the output.
- **Rotate** a value: change it in `.env` (and in PostgreSQL first for a password) and re-run. The API pods carry a
  checksum of the Secret, so they restart with the new values. A new VAPID pair invalidates every browser
  subscription (users enable notifications again).
- The pull Secret is a copy: when the robot token in `keycloak` changes, delete `cr-homel4b` here and copy it again.

## Migrations

The app role cannot change tables, so by default migrations are applied by hand as the migrator role, from a machine
that reaches the database (see [docs/DEPLOY.md "Applying migrations"](../../docs/DEPLOY.md#applying-migrations)):

```bash
cd code/api && dotnet tool restore
DB_HOST=... DB_PORT=5432 DB_NAME=lotties DB_MIGRATOR_USER=... DB_MIGRATOR_PASSWORD=... \
  dotnet ef database update --project src/Lotties.Infrastructure
```

Opt-in alternative: `DB_AUTO_MIGRATE=true` with `DB_MIGRATOR_USER`/`DB_MIGRATOR_PASSWORD` in `.env`. The API then
migrates at start (an advisory lock serializes pods; the startup probe allows 6 minutes). **The API pod then holds the
migrator credentials**; prefer the manual way for production. Apply migrations before deploying an API that needs them.

## Verify

```bash
kubectl --context home-lab-main -n lotties-app-production get pods,svc,ingress,certificate
curl -sI https://lotties.app/ | grep -iE 'content-security-policy|cache-control'
curl -s -o /dev/null -w '%{http_code}\n' https://lotties.app/api/v1/me      # 401: the API answers, no token
kubectl --context home-lab-main -n lotties-app-production logs deploy/lotties-api
```

Then sign in at https://lotties.app. `/health` is not public; check it with
`kubectl ... port-forward svc/lotties-api 18080:8080` and `curl localhost:18080/health`.

## Roll back

```bash
helm --kube-context home-lab-main -n lotties-app-production history lotties-api
helm --kube-context home-lab-main -n lotties-app-production rollback lotties-api [REVISION]   # or lotties-web
```

A rollback restores the image and settings of that revision, not the Secret (re-run the script with the old values)
and not the database schema (migrations are forward only; make them backward compatible).

## Design notes and limits

- **Verified without touching the cluster:** `bash -n`, `deploy.test.sh` (stand-ins for kubectl, helm and podman),
  `helm lint`, and `DRY_RUN=1` against `home-lab-main` (read-only gets, `helm template`, `kubectl apply --dry-run=client`
  of every manifest). The web image was built and run locally like the pod (read-only, uid 101). Not done: a real run,
  the API image build in this kit, a certificate issuance, and a sign-in through the Ingress.
- **One replica each.** Both are stateless; `replicaCount` can go up (the push scheduler takes a database lease).
- **Client addresses:** the `traefik-external` Service uses `externalTrafficPolicy: Cluster`, so traffic can be
  source-NATed to a node address before Traefik and the API sees that as the client. Only the anonymous push action
  route is limited per address; signed-in requests are limited per user. `externalTrafficPolicy: Local` on that Service
  (a cluster-wide choice) keeps the real address.
- **HSTS is not set** (docs/DEPLOY.md asks for it at the TLS proxy). Traefik reads Middlewares only from the
  `traefik-external` namespace: a headers Middleware there (`stsSeconds: 31536000`, `stsIncludeSubdomains: true`) plus the
  annotation `traefik.ingress.kubernetes.io/router.middlewares: traefik-external-<name>@kubernetescrd` would add it.
- **CI later:** the script already runs with `KUBE_CONTEXT=in-cluster` (a runner's service account), as in the snake
  game kit; no runner is set up here.
