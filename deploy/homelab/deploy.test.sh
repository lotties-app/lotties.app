#!/usr/bin/env bash
# Checks deploy.sh: its pure helpers (env file loading, source tags, version bump, ...), then whole runs against
# stand-ins for kubectl, helm and podman that only record what they are asked. No cluster, registry or network is used.
# Run: bash deploy/homelab/deploy.test.sh
set -uo pipefail

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
DEPLOY="$HERE/deploy.sh"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
FAILED=0

check() { # description, command...
  local description=$1
  shift
  if "$@"; then echo "ok - $description"; else echo "not ok - $description"; FAILED=1; fi
}
equals() { [ "$1" = "$2" ] || { echo "    wanted '$2', got '$1'"; return 1; }; }

# ── Pure helpers ──────────────────────────────────────────────────────────────
# shellcheck source=deploy.sh
source "$DEPLOY"
set +e

printf 'A=plain  \r\nB = "quoted value" \t\r\n  # comment\r\nexport C=exported\n1BAD=x\nD='"'"'single'"'"'\nE=kept-from-env\nF=a=b\n' > "$WORK/dirty.env"
(
  export E=from-env
  load_env_file "$WORK/dirty.env"
  check "env file: trailing spaces and CRLF are dropped" equals "$A" plain
  check "env file: spaces around = and double quotes are dropped" equals "$B" "quoted value"
  check "env file: export prefix is accepted" equals "$C" exported
  check "env file: single quotes are dropped" equals "$D" single
  check "env file: the environment wins over the file" equals "$E" from-env
  check "env file: a value may contain =" equals "$F" a=b
  check "env file: an invalid key is skipped" bash -c '! env | grep -q "^1BAD="'
)
check "env file: a missing file is no error" load_env_file "$WORK/none.env"

expect_version() { # description expected bump tags...
  local description=$1 expected=$2 bump=$3
  shift 3
  check "version: $description" equals "$(printf '%s\n' "$@" | bump_version "$bump")" "$expected"
}
expect_version "no tags yet starts at 1.0.0" 1.0.0 patch
expect_version "a patch goes one up" 0.1.1 patch v0.1.0
expect_version "numbers are compared as numbers" 1.0.11 patch v1.0.0 v1.0.9 v1.0.10
expect_version "a minor resets the patch" 1.3.0 minor v1.0.5 v1.2.7
expect_version "a major resets minor and patch" 2.0.0 major v1.4.2
expect_version "tags that are not vX.Y.Z are ignored" 1.0.1 patch v1.0.0 v1.0.0-rc1 latest src-abc 1.5.0
check "version: an unknown bump is refused" bash -c "! printf 'v1.0.0\n' | (source '$DEPLOY'; bump_version sideways) 2>/dev/null"

check "bool: true" equals "$(parse_bool TRUE)" true
check "bool: 0 is false" equals "$(parse_bool 0)" false
check "bool: empty is false" equals "$(parse_bool '')" false
check "bool: anything else fails" bash -c "! (source '$DEPLOY'; parse_bool yes)"
check "helm value: commas and backslashes are escaped" equals "$(helm_escape 'a,b\c')" 'a\,b\\c'
check "placeholder: <spa-client-id> is one" is_placeholder '<spa-client-id>'
check "placeholder: mailto:<operator@example.com> is one" is_placeholder 'mailto:<operator@example.com>'
check "placeholder: a real value is not" bash -c "! (source '$DEPLOY'; is_placeholder 'lotties-web')"

# Source tags in a throw-away repository.
REPO="$WORK/repo"
mkdir -p "$REPO/code/web/src" "$REPO/code/web/dist"
git -C "$REPO" init -q
printf 'dist/\n' > "$REPO/code/web/.gitignore"
printf 'one' > "$REPO/code/web/src/a.ts"
printf 'built' > "$REPO/code/web/dist/out.js"
git -C "$REPO" add -A >/dev/null
first=$(source_tag "" code/web)
check "tag: the form is src-<12 hex>" bash -c "[[ '$first' =~ ^src-[0-9a-f]{12}$ ]]"
check "tag: the same files give the same tag" equals "$(source_tag "" code/web)" "$first"
printf 'changed' > "$REPO/code/web/dist/out.js"
check "tag: a .gitignored file does not count" equals "$(source_tag "" code/web)" "$first"
printf 'two' > "$REPO/code/web/src/b.ts"
second=$(source_tag "" code/web)
check "tag: an untracked file counts" bash -c "[ '$second' != '$first' ]"
printf 'one!' > "$REPO/code/web/src/a.ts"
check "tag: a changed working-tree file counts" bash -c "[ '$(source_tag "" code/web)' != '$second' ]"
VITE_API_BASE_URL="" VITE_OIDC_AUTHORITY=https://auth.example.test/realms/r VITE_OIDC_AUDIENCE="" VITE_REPO_URL=""
VITE_PRIVACY_CONTROLLER_NAME="" VITE_PRIVACY_CONTACT_EMAIL="" VITE_PRIVACY_DPO=""
VITE_OIDC_CLIENT_ID=web-a; salt_a=$(web_build_salt)
VITE_OIDC_CLIENT_ID=web-b; salt_b=$(web_build_salt)
check "tag: a different web build argument is a different tag" bash -c "[ '$(source_tag "$salt_a" code/web)' != '$(source_tag "$salt_b" code/web)' ]"
VITE_PRIVACY_CONTACT_EMAIL=privacy@example.test; salt_c=$(web_build_salt); VITE_PRIVACY_CONTACT_EMAIL=""
check "tag: a different privacy contact is a different tag" bash -c "[ '$(source_tag "$salt_b" code/web)' != '$(source_tag "$salt_c" code/web)' ]"
check "tag: TAG overrides the source tag" equals "$(TAG=fixed image_tag "" code/web)" fixed
salt_v1=$(VERSION=0.1.38 APP_VERSION=0.1.38 web_build_salt); salt_v2=$(VERSION=0.1.39 APP_VERSION=0.1.39 web_build_salt)
check "tag: the release number is not part of the web tag" equals "$(source_tag "$salt_v2" code/web)" "$(source_tag "$salt_v1" code/web)"
check "stamp: the release, commit and build time are build arguments, without the v" \
  equals "$(release_build_args v0.1.38 abc1234 2026-10-24T10:00:00Z | tr '\n' ' ')" \
  '--build-arg APP_VERSION=0.1.38 --build-arg APP_COMMIT=abc1234 --build-arg APP_BUILD_TIME=2026-10-24T10:00:00Z '
check "stamp: no release gives an empty APP_VERSION (the app shows dev)" \
  bash -c "(source '$DEPLOY'; release_build_args '' c t) | grep -qx 'APP_VERSION='"

# ── Whole runs against stand-ins ──────────────────────────────────────────────
mkdir "$WORK/bin"
cat > "$WORK/bin/kubectl" <<'STUB'
#!/usr/bin/env bash
printf 'kubectl %s\n' "$*" >> "$STUB_LOG"
args=" $* "
case "$args" in
  *" get namespace "*) [ "${STUB_NS_EXISTS:-yes}" = yes ]; exit ;;
  *" -n keycloak get secret cr-homel4b "*"{.type}"*) printf 'kubernetes.io/dockerconfigjson' ;;
  *" -n keycloak get secret cr-homel4b "*dockerconfigjson*) printf '%s' 'eyJhdXRocyI6e319' ;;
  *" get secret cr-homel4b "*"{.type}"*) [ "${STUB_PULL_SECRET:-yes}" = yes ] && printf 'kubernetes.io/dockerconfigjson' || exit 1 ;;
  *" get secret lotties-secrets "*) exit 1 ;;
  *" create secret generic "*)
    dir=$(printf '%s\n' "$@" | sed -n 's/^--from-file=//p')
    printf 'secret-keys: %s\n' "$(cd "$dir" && ls | tr '\n' ' ')" >> "$STUB_LOG"
    printf 'apiVersion: v1\nkind: Secret\n' ;;
  *" create secret docker-registry "*) cat > /dev/null ;;
  *" label --local "*) cat ;;
  *" apply "*" -f - "*) cat > /dev/null ;;
esac
exit 0
STUB
cat > "$WORK/bin/helm" <<'STUB'
#!/usr/bin/env bash
printf 'helm %s\n' "$*" >> "$STUB_LOG"
case " $* " in *" template "*) printf 'apiVersion: apps/v1\nkind: Deployment\n' ;; esac
exit 0
STUB
cat > "$WORK/bin/podman" <<'STUB'
#!/usr/bin/env bash
printf 'podman %s\n' "$*" >> "$STUB_LOG"
case "$*" in
  "login --get-login"*) echo robot ;;
  "search --list-tags"*) printf '%s\n' "${STUB_TAGS:-}" ;;
  build*) echo 0123456789ab ;;
esac
exit 0
STUB
chmod +x "$WORK/bin/"*

PASSWORD='Sup3r-Secret-Pass'
cat > "$WORK/app.env" <<EOF
VITE_OIDC_CLIENT_ID=lotties-web
DB_HOST=db.example.test
DB_APP_USER=k_lotties_usr
DB_APP_PASSWORD=$PASSWORD
EOF

run() { # name, env assignments... ; leaves the log in $WORK/log and the output in $WORK/out
  local name=$1
  shift
  : > "$WORK/log"
  env -i PATH="$WORK/bin:$PATH" HOME="$WORK" STUB_LOG="$WORK/log" ENV_FILE="$WORK/app.env" KUBE_CONTEXT=mine \
    REGISTRY=reg.test/lotties "$@" bash "$DEPLOY" > "$WORK/out" 2>&1 < /dev/null
  RUN_CODE=$?
  [ "$RUN_CODE" -eq 0 ] || [ "${EXPECT_FAIL:-0}" = 1 ] || { echo "not ok - $name: deploy.sh exited $RUN_CODE"; sed 's/^/    /' "$WORK/out" | tail -5; FAILED=1; return 1; }
}
log_has() { grep -qE -- "$1" "$WORK/log"; }
log_lacks() { ! grep -qE -- "$1" "$WORK/log"; }
out_has() { grep -qE -- "$1" "$WORK/out"; }
no_password() { ! grep -qF -- "$PASSWORD" "$WORK/log" "$WORK/out"; }

run "dry run" DRY_RUN=1 DRY_RUN_DIR="$WORK/rendered" STUB_NS_EXISTS=no STUB_PULL_SECRET=no && {
  check "dry run: nothing is built, pushed or tagged" log_lacks '^podman (build|push|tag|pull)'
  check "dry run: no helm install" log_lacks '^helm .*upgrade'
  check "dry run: nothing is created" log_lacks '^kubectl .* create '
  check "dry run: every kubectl apply is a client dry run" bash -c "! grep '^kubectl .* apply ' '$WORK/log' | grep -v -- '--dry-run=client'"
  check "dry run: the namespace would be created" out_has 'namespace.yaml|would create'
  check "dry run: the pull Secret would be copied" out_has 'would copy cr-homel4b from namespace keycloak'
  check "dry run: the images would be built" out_has 'would build and push it: podman build .*lotties-web'
  check "dry run: the release is chosen before the builds and stamped into them" out_has 'would build and push it: podman build .*lotties-api:src-[0-9a-f]{12} .*--build-arg APP_VERSION=[0-9]+\.[0-9]+\.[0-9]+ '
  check "dry run: the Secret keys are listed" out_has 'keys: DB_APP_PASSWORD DB_APP_USER DB_HOST DB_NAME DB_PORT'
  check "dry run: the Ingress is rendered for lotties.app" grep -q 'host: "lotties.app"' "$WORK/rendered/ingress.yaml"
  check "dry run: /api goes to the API" bash -c "grep -A4 'path: /api' '$WORK/rendered/ingress.yaml' | grep -q 'name: lotties-api'"
  check "dry run: the MCP resource metadata goes to the API" bash -c "grep -A4 'path: /.well-known/oauth-protected-resource' '$WORK/rendered/ingress.yaml' | grep -q 'name: lotties-api'"
  check "dry run: the certificate comes from the issuer" grep -q 'cert-manager.io/cluster-issuer: letsencrypt-production-lotties-app-issuer' "$WORK/rendered/ingress.yaml"
  check "dry run: the namespace is labelled" grep -q 'app.kubernetes.io/part-of: lotties' "$WORK/rendered/namespace.yaml"
  check "dry run: both releases are rendered" bash -c "[ -s '$WORK/rendered/lotties-api.yaml' ] && [ -s '$WORK/rendered/lotties-web.yaml' ]"
  check "dry run: no secret value is printed" no_password
}

run "real run" STUB_NS_EXISTS=no && {
  check "real: the namespace is created" log_has '^kubectl --context mine apply -f .*/namespace\.yaml'
  check "real: the API image is built from code/api" log_has '^podman build --network host -q -t reg\.test/lotties/lotties-api:src-[0-9a-f]{12} -f .*/code/api/Dockerfile .*/code/api$'
  check "real: the web image gets the client id" log_has '^podman build .*lotties-web:src-[0-9a-f]{12} .*--build-arg VITE_OIDC_CLIENT_ID=lotties-web'
  check "real: the authority defaults to the realm" log_has '--build-arg VITE_OIDC_AUTHORITY=https://auth\.lotties\.app/realms/lotties\.app'
  check "real: images are pushed" log_has '^podman push -q reg\.test/lotties/lotties-web:src-'
  check "real: a build is a release (vX.Y.Z and latest)" log_has '^podman push -q reg\.test/lotties/lotties-api:v[0-9]+\.[0-9]+\.[0-9]+$'
  check "real: the Secret is made from files" log_has '^kubectl --context mine -n lotties-app-production create secret generic lotties-secrets --from-file='
  check "real: the Secret has the database keys, no push or migrator keys" log_has '^secret-keys: DB_APP_PASSWORD DB_APP_USER DB_HOST DB_NAME DB_PORT $'
  check "real: the Secret is applied server-side" log_has 'apply --server-side --force-conflicts --field-manager=lotties-deploy -f -'
  check "real: the API release" log_has '^helm --kube-context mine -n lotties-app-production upgrade --install lotties-api .*image\.tag=src-'
  check "real: CORS allows the public host" log_has 'env\.CORS_ALLOWED_ORIGINS=https://lotties\.app'
  check "real: the API pods carry the Secret checksum" log_has 'podAnnotations\.checksum/secrets=[0-9a-f]{16}'
  check "real: auto migration is off" log_has 'env\.DB_AUTO_MIGRATE=false'
  check "real: the web release points nginx at the API Service" log_has 'upgrade --install lotties-web .*env\.API_UPSTREAM=lotties-api\.lotties-app-production\.svc\.cluster\.local:8080'
  check "real: helm waits" log_has 'upgrade --install lotties-web .*--wait --timeout 10m'
  check "real: the Ingress is applied" log_has '^kubectl --context mine apply -f .*/ingress\.yaml'
  check "real: no secret value is on a command line or printed" no_password
  release=$(sed -nE 's#^podman push -q reg\.test/lotties/lotties-api:v([0-9]+\.[0-9]+\.[0-9]+)$#\1#p' "$WORK/log" | head -n 1)
  check "real: the API image carries the release it is tagged with" log_has "^podman build .*lotties-api:src-[0-9a-f]{12} .*--build-arg APP_VERSION=${release//./\\.} "
  check "real: the web image carries the same release" log_has "^podman build .*lotties-web:src-[0-9a-f]{12} .*--build-arg APP_VERSION=${release//./\\.} "
  check "real: both images carry the commit and an ISO build time" \
    bash -c "[ \$(grep -cE -- '--build-arg APP_COMMIT=[0-9a-f]* --build-arg APP_BUILD_TIME=[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z' '$WORK/log') -eq 2 ]"
  grep -oE 'lotties-(api|web):src-[0-9a-f]{12}' "$WORK/log" | sort -u > "$WORK/tags-real"
}

run "fixed release" VERSION=v9.8.7 && {
  check "fixed release: both images carry it" bash -c "[ \$(grep -c -- '--build-arg APP_VERSION=9\.8\.7 ' '$WORK/log') -eq 2 ]"
  grep -oE 'lotties-(api|web):src-[0-9a-f]{12}' "$WORK/log" | sort -u > "$WORK/tags-fixed"
  check "fixed release: the image tags do not depend on the release number" cmp -s "$WORK/tags-real" "$WORK/tags-fixed"
}

run "unchanged run" STUB_TAGS="$(grep -oE 'lotties-(api|web):src-[0-9a-f]{12}' "$WORK/log" | sed 's/.*://' | sort -u)" && {
  check "unchanged: nothing is built" log_lacks '^podman build'
  check "unchanged: no new version" log_lacks '^podman tag'
}

EXPECT_FAIL=1 run "pull secret missing, no flag" STUB_PULL_SECRET=no
check "pull secret: a missing one stops a non-interactive run" bash -c "[ $RUN_CODE -ne 0 ]"
check "pull secret: the copy command is shown" out_has 'create secret docker-registry cr-homel4b --from-file=\.dockerconfigjson=/dev/stdin'

run "pull secret copy" STUB_PULL_SECRET=no COPY_PULL_SECRET=1 SKIP_BUILD=1 && {
  check "pull secret: read from keycloak" log_has '^kubectl --context mine -n keycloak get secret cr-homel4b -o jsonpath=\{\.data\.\\\.dockerconfigjson\}'
  check "pull secret: created from stdin" log_has '^kubectl --context mine -n lotties-app-production create secret docker-registry cr-homel4b --from-file=\.dockerconfigjson=/dev/stdin'
  check "skip build: nothing is built" log_lacks '^podman build'
}

EXPECT_FAIL=1 run "auto migrate without migrator" DB_AUTO_MIGRATE=true SKIP_BUILD=1
check "auto migrate: needs the migrator role" out_has 'DB_MIGRATOR_USER \(needed by DB_AUTO_MIGRATE=true\)'

run "auto migrate" DB_AUTO_MIGRATE=true DB_MIGRATOR_USER=migrator DB_MIGRATOR_PASSWORD=m1grat0r SKIP_BUILD=1 && {
  check "auto migrate: the Secret gets the migrator keys" log_has '^secret-keys: .*DB_MIGRATOR_PASSWORD DB_MIGRATOR_USER'
  check "auto migrate: the API is told" log_has 'env\.DB_AUTO_MIGRATE=true'
}

EXPECT_FAIL=1 run "partial push" PUSH_VAPID_PUBLIC_KEY=pub SKIP_BUILD=1
check "push: one key alone is refused" out_has 'all three PUSH_VAPID_\* values or none'

run "push on" PUSH_VAPID_PUBLIC_KEY=pub PUSH_VAPID_PRIVATE_KEY=priv PUSH_VAPID_SUBJECT=mailto:op@example.test SKIP_BUILD=1 && {
  check "push: the three keys go to the Secret" log_has '^secret-keys: .*PUSH_VAPID_PRIVATE_KEY PUSH_VAPID_PUBLIC_KEY PUSH_VAPID_SUBJECT'
}

run "no admin client" SKIP_BUILD=1 && {
  check "admin client: none keeps the Keycloak user, and says so" out_has 'account deletion: keeps the Keycloak user'
  check "admin client: no AUTH_ADMIN_* key in the Secret" log_lacks '^secret-keys: .*AUTH_ADMIN_'
}

EXPECT_FAIL=1 run "partial admin client" AUTH_ADMIN_CLIENT_ID=lotties-account-deletion SKIP_BUILD=1
check "admin client: the id alone is refused" out_has 'both AUTH_ADMIN_CLIENT_ID and AUTH_ADMIN_CLIENT_SECRET or neither'

ADMIN_SECRET='Adm1n-Cl1ent-S3cret'
run "admin client on" AUTH_ADMIN_CLIENT_ID=lotties-account-deletion AUTH_ADMIN_CLIENT_SECRET="$ADMIN_SECRET" SKIP_BUILD=1 && {
  check "admin client: both keys go to the Secret" log_has '^secret-keys: AUTH_ADMIN_CLIENT_ID AUTH_ADMIN_CLIENT_SECRET DB_'
  check "admin client: deletion also removes the Keycloak user" out_has 'account deletion: also deletes the Keycloak user'
  check "admin client: the secret is never on a command line or printed" bash -c "! grep -qF -- '$ADMIN_SECRET' '$WORK/log' '$WORK/out'"
}

EXPECT_FAIL=1 run "admin client placeholder" AUTH_ADMIN_CLIENT_ID=lotties-account-deletion AUTH_ADMIN_CLIENT_SECRET='<admin-client-secret>' SKIP_BUILD=1
check "admin client: the .env.example placeholder is refused" out_has 'AUTH_ADMIN_CLIENT_SECRET is still the .env.example placeholder'

EXPECT_FAIL=1 run "placeholder" VITE_OIDC_CLIENT_ID='<spa-client-id>' SKIP_BUILD=1
check "placeholder: refused" out_has 'VITE_OIDC_CLIENT_ID is still the .env.example placeholder'

run "no issuer" DRY_RUN=1 DRY_RUN_DIR="$WORK/rendered-no-issuer" CLUSTER_ISSUER= SKIP_BUILD=1 && {
  check "no issuer: the annotation is left out" bash -c "! grep -q 'cert-manager.io/cluster-issuer' '$WORK/rendered-no-issuer/ingress.yaml'"
}

run "trusted networks" FORWARDED_HEADERS_TRUSTED_NETWORKS=10.42.0.0/16,10.43.0.0/16 SKIP_BUILD=1 && {
  check "trusted networks: passed with the comma escaped" log_has 'env\.FORWARDED_HEADERS_TRUSTED_NETWORKS=10\.42\.0\.0/16\\,10\.43\.0\.0/16'
}

run "native app origins" CORS_ALLOWED_ORIGINS=https://lotties.app,https://localhost,capacitor://localhost SKIP_BUILD=1 && {
  check "native app: CORS lists the WebView origins, commas escaped" log_has 'env\.CORS_ALLOWED_ORIGINS=https://lotties\.app\\,https://localhost\\,capacitor://localhost'
}

EXPECT_FAIL=1 run "bad CORS origin" CORS_ALLOWED_ORIGINS='https://lotties.app/app, https://localhost' SKIP_BUILD=1
check "CORS: a path or a space is refused" out_has 'CORS_ALLOWED_ORIGINS must be comma-separated origins'

exit "$FAILED"
