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

KEK_A=$(head -c 32 /dev/urandom | base64 | tr -d '\n')
KEK_B=$(head -c 32 /dev/urandom | base64 | tr -d '\n')
check "store key: base64 of 32 random bytes is one" is_store_kek "$KEK_A"
check "store key: 31 bytes is not" bash -c "! (source '$DEPLOY'; is_store_kek '$(head -c 31 /dev/urandom | base64 | tr -d '\n')')"
check "store key: 33 bytes is not" bash -c "! (source '$DEPLOY'; is_store_kek '$(head -c 33 /dev/urandom | base64 | tr -d '\n')')"
check "store key: unpadded is not" bash -c "! (source '$DEPLOY'; is_store_kek '${KEK_A%=}')"
check "store key: a passphrase is not" bash -c "! (source '$DEPLOY'; is_store_kek 'correct horse battery staple')"
check "store key id: k1 is one" is_store_key_id k1
check "store key id: dashes are allowed inside" is_store_key_id 2026-11-a
check "store key id: upper case is not" bash -c "! (source '$DEPLOY'; is_store_key_id K1)"
check "store key id: 33 characters is not" bash -c "! (source '$DEPLOY'; is_store_key_id '$(printf 'a%.0s' {1..33})')"
check "list: entries are trimmed and empty ones dropped" equals "$(split_list ' a , b,,c ' | tr '\n' ' ')" 'a b c '
check "list: a star is not expanded" equals "$(cd "$WORK" && split_list '*')" '*'

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
VITE_ISSUES_URL="" VITE_SUPPORT_URL=""
VITE_OIDC_CLIENT_ID=web-a; salt_a=$(web_build_salt)
VITE_OIDC_CLIENT_ID=web-b; salt_b=$(web_build_salt)
check "tag: a different web build argument is a different tag" bash -c "[ '$(source_tag "$salt_a" code/web)' != '$(source_tag "$salt_b" code/web)' ]"
VITE_PRIVACY_CONTACT_EMAIL=privacy@example.test; salt_c=$(web_build_salt); VITE_PRIVACY_CONTACT_EMAIL=""
check "tag: a different privacy contact is a different tag" bash -c "[ '$(source_tag "$salt_b" code/web)' != '$(source_tag "$salt_c" code/web)' ]"
VITE_SUPPORT_URL=https://example.test/support; salt_d=$(web_build_salt); VITE_SUPPORT_URL=""
check "tag: a different support link is a different tag" bash -c "[ '$(source_tag "$salt_b" code/web)' != '$(source_tag "$salt_d" code/web)' ]"
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
  *" -n shared-ns get secret pull-test "*"{.type}"*) printf 'kubernetes.io/dockerconfigjson' ;;
  *" -n shared-ns get secret pull-test "*dockerconfigjson*) printf '%s' 'eyJhdXRocyI6e319' ;;
  *" get secret pull-test "*"{.type}"*) [ "${STUB_PULL_SECRET:-yes}" = yes ] && printf 'kubernetes.io/dockerconfigjson' || exit 1 ;;
  # The API's Secret in the cluster: STUB_SECRET_FILE (KEY=value lines) when given, else none; STUB_SECRET_FAIL=1 cannot read it.
  *" get secret lotties-secrets "*)
    [ "${STUB_SECRET_FAIL:-0}" = 1 ] && { echo 'Unable to connect to the server' >&2; exit 1; }
    [ -n "${STUB_SECRET_FILE:-}" ] || { echo 'Error from server (NotFound): secrets "lotties-secrets" not found' >&2; exit 1; }
    case "$args" in
      *go-template*) cut -d= -f1 "$STUB_SECRET_FILE" ;;
      *) key=$(printf '%s' "$*" | sed -n "s/.*{\.data\['\([^']*\)'\]}.*/\1/p")
         line=$(grep -m1 "^$key=" "$STUB_SECRET_FILE") || exit 0
         printf '%s' "${line#*=}" | base64 | tr -d '\n' ;;
    esac ;;
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
DB_APP_USER=app_usr
DB_APP_PASSWORD=$PASSWORD
EOF

# The cluster-specific settings (required, no defaults in deploy.sh) of every whole run; an argument of run() wins.
DEPLOY_SETTINGS=(KUBE_CONTEXT=mine REGISTRY=reg.test/lotties INGRESS_CLASS=ingress-test CLUSTER_ISSUER=issuer-test
  PULL_SECRET=pull-test PULL_SECRET_SOURCE_NS=shared-ns)
run() { # name, env assignments... ; leaves the log in $WORK/log and the output in $WORK/out
  local name=$1
  shift
  : > "$WORK/log"
  env -i PATH="$WORK/bin:$PATH" HOME="$WORK" STUB_LOG="$WORK/log" ENV_FILE="$WORK/app.env" \
    "${DEPLOY_SETTINGS[@]}" TAG_RELEASE=0 "$@" bash "$DEPLOY" > "$WORK/out" 2>&1 < /dev/null
  RUN_CODE=$?
  [ "$RUN_CODE" -eq 0 ] || [ "${EXPECT_FAIL:-0}" = 1 ] || { echo "not ok - $name: deploy.sh exited $RUN_CODE"; sed 's/^/    /' "$WORK/out" | tail -5; FAILED=1; return 1; }
}
log_has() { grep -qE -- "$1" "$WORK/log"; }
log_lacks() { ! grep -qE -- "$1" "$WORK/log"; }
out_has() { grep -qE -- "$1" "$WORK/out"; }
out_lacks() { ! grep -qE -- "$1" "$WORK/out"; }
no_password() { ! grep -qF -- "$PASSWORD" "$WORK/log" "$WORK/out"; }

run "dry run" DRY_RUN=1 DRY_RUN_DIR="$WORK/rendered" STUB_NS_EXISTS=no STUB_PULL_SECRET=no && {
  check "dry run: nothing is built, pushed or tagged" log_lacks '^podman (build|push|tag|pull)'
  check "dry run: no helm install" log_lacks '^helm .*upgrade'
  check "dry run: nothing is created" log_lacks '^kubectl .* create '
  check "dry run: every kubectl apply is a client dry run" bash -c "! grep '^kubectl .* apply ' '$WORK/log' | grep -v -- '--dry-run=client'"
  check "dry run: the namespace would be created" out_has 'namespace.yaml|would create'
  check "dry run: the pull Secret would be copied" out_has 'would copy pull-test from namespace shared-ns'
  check "dry run: the images would be built" out_has 'would build and push it: podman build .*lotties-web'
  check "dry run: the release is chosen before the builds and stamped into them" out_has 'would build and push it: podman build .*lotties-api:src-[0-9a-f]{12} .*--build-arg APP_VERSION=[0-9]+\.[0-9]+\.[0-9]+ '
  check "dry run: the Secret keys are listed" out_has 'keys: DB_APP_PASSWORD DB_APP_USER DB_HOST DB_NAME DB_PORT'
  check "dry run: the Ingress is rendered for lotties.app" grep -q 'host: "lotties.app"' "$WORK/rendered/ingress.yaml"
  check "dry run: /api goes to the API" bash -c "grep -A4 'path: /api' '$WORK/rendered/ingress.yaml' | grep -q 'name: lotties-api'"
  check "dry run: the MCP resource metadata goes to the API" bash -c "grep -A4 'path: /.well-known/oauth-protected-resource' '$WORK/rendered/ingress.yaml' | grep -q 'name: lotties-api'"
  check "dry run: the certificate comes from the issuer" grep -q 'cert-manager.io/cluster-issuer: issuer-test' "$WORK/rendered/ingress.yaml"
  check "dry run: the Ingress has the configured class" grep -q 'ingressClassName: ingress-test' "$WORK/rendered/ingress.yaml"
  check "dry run: the releases pull with the configured Secret" bash -c "[ \$(grep -c '^helm .* template .*imagePullSecrets\[0\]\.name=pull-test' '$WORK/log') -eq 2 ]"
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

# Release tag: in a throw-away clone with a bare origin (a whole run never tags: run() sets TAG_RELEASE=0, REPO is this repository).
TAGREPO="$WORK/tagrepo"; ORIGIN="$WORK/origin.git"
git init -q --bare "$ORIGIN"
git init -q "$TAGREPO"
git -C "$TAGREPO" -c user.name=t -c user.email=t@example.test commit -q --allow-empty -m first
git -C "$TAGREPO" remote add origin "$ORIGIN"
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@example.test GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@example.test
tag_out=$(REPO="$TAGREPO"; tag_release 4.5.6 2>&1)
check "release tag: an annotated tag is created on HEAD" bash -c "[ \"\$(git -C '$TAGREPO' cat-file -t v4.5.6)\" = tag ]"
check "release tag: it is pushed to origin" bash -c "git -C '$ORIGIN' rev-parse -q --verify refs/tags/v4.5.6 >/dev/null"
tag_again=$(REPO="$TAGREPO"; tag_release 4.5.6 2>&1)
check "release tag: an existing tag is left alone" bash -c "[[ '$tag_again' == *'already exists'* ]]"
printf 'x' > "$TAGREPO/dirty.txt"
tag_dirty=$(REPO="$TAGREPO"; tag_release 4.5.7 2>&1)
check "release tag: a dirty working tree is said out loud" bash -c "[[ '$tag_dirty' == *'uncommitted changes'* ]]"
tag_off=$(REPO="$TAGREPO"; TAG_RELEASE=0 tag_release 4.5.8 2>&1)
check "release tag: TAG_RELEASE=0 creates nothing" bash -c "! git -C '$TAGREPO' rev-parse -q --verify refs/tags/v4.5.8 >/dev/null"
tag_nopush=$(REPO="$TAGREPO"; PUSH_TAG=0 tag_release 4.5.9 2>&1)
check "release tag: PUSH_TAG=0 keeps it local" bash -c "git -C '$TAGREPO' rev-parse -q --verify refs/tags/v4.5.9 >/dev/null && ! git -C '$ORIGIN' rev-parse -q --verify refs/tags/v4.5.9 >/dev/null"
unset GIT_AUTHOR_NAME GIT_AUTHOR_EMAIL GIT_COMMITTER_NAME GIT_COMMITTER_EMAIL

EXPECT_FAIL=1 run "pull secret missing, no flag" STUB_PULL_SECRET=no
check "pull secret: a missing one stops a non-interactive run" bash -c "[ $RUN_CODE -ne 0 ]"
check "pull secret: the copy command is shown" out_has 'create secret docker-registry pull-test --from-file=\.dockerconfigjson=/dev/stdin'

run "pull secret copy" STUB_PULL_SECRET=no COPY_PULL_SECRET=1 SKIP_BUILD=1 && {
  check "pull secret: read from the source namespace" log_has '^kubectl --context mine -n shared-ns get secret pull-test -o jsonpath=\{\.data\.\\\.dockerconfigjson\}'
  check "pull secret: created from stdin" log_has '^kubectl --context mine -n lotties-app-production create secret docker-registry pull-test --from-file=\.dockerconfigjson=/dev/stdin'
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

# Widget silent pushes (docs/design/37b-widget-silent-push.md): keys only in the Secret, the flag a plain env value.
SP_P8='QXBuc1AtOC1LZXktTWF0ZXJpYWw='
SP_JSON='RmNtLVNlcnZpY2UtQWNjb3VudC1Kc29u'
silent_push_hidden() { ! grep -qF -- "$SP_P8" "$WORK/log" "$WORK/out" && ! grep -qF -- "$SP_JSON" "$WORK/log" "$WORK/out" \
  && ! grep -qF -- 'APNSKEYID1' "$WORK/log" "$WORK/out" && ! grep -qF -- 'fcm-proj-1' "$WORK/log" "$WORK/out"; }

run "silent push off by default" SKIP_BUILD=1 && {
  check "silent push: the flag defaults to false" log_has 'env\.SILENT_PUSH_ENABLED=false'
  check "silent push: off and says so" out_has 'widget silent pushes: off'
  check "silent push: no PUSH_APNS_/PUSH_FCM_ key in the Secret" log_lacks '^secret-keys: .*PUSH_(APNS|FCM)_'
}

EXPECT_FAIL=1 run "silent push bad flag" SILENT_PUSH_ENABLED=maybe SKIP_BUILD=1
check "silent push: a flag that is not a boolean is refused" out_has 'SILENT_PUSH_ENABLED must be true or false'

EXPECT_FAIL=1 run "silent push without a channel" SILENT_PUSH_ENABLED=true SKIP_BUILD=1
check "silent push: on without a channel is refused" out_has 'SILENT_PUSH_ENABLED=true needs the PUSH_APNS_\* or the PUSH_FCM_\* values'

EXPECT_FAIL=1 run "partial apns" PUSH_APNS_KEY_ID=APNSKEYID1 SKIP_BUILD=1
check "silent push: one APNs key alone is refused" out_has 'all three of PUSH_APNS_KEY_ID, PUSH_APNS_TEAM_ID and PUSH_APNS_KEY_P8 or none'

EXPECT_FAIL=1 run "partial fcm" PUSH_FCM_PROJECT_ID=fcm-proj-1 SKIP_BUILD=1
check "silent push: the FCM project alone is refused" out_has 'both PUSH_FCM_PROJECT_ID and PUSH_FCM_SERVICE_ACCOUNT_JSON or neither'

EXPECT_FAIL=1 run "apns placeholder" PUSH_APNS_KEY_ID=APNSKEYID1 PUSH_APNS_TEAM_ID=TEAM1 PUSH_APNS_KEY_P8='<base64-of-the-p8-file>' SKIP_BUILD=1
check "silent push: the .env.example placeholder is refused" out_has 'PUSH_APNS_KEY_P8 is still the .env.example placeholder'

run "silent push on" SILENT_PUSH_ENABLED=true PUSH_APNS_KEY_ID=APNSKEYID1 PUSH_APNS_TEAM_ID=TEAM1 PUSH_APNS_KEY_P8="$SP_P8" \
  PUSH_APNS_BUNDLE_ID=app.lotties.app PUSH_FCM_PROJECT_ID=fcm-proj-1 PUSH_FCM_SERVICE_ACCOUNT_JSON="$SP_JSON" SKIP_BUILD=1 && {
  check "silent push: the Secret is made from files" log_has '^kubectl .* create secret generic lotties-secrets --from-file='
  check "silent push: the APNs keys go to the Secret" log_has '^secret-keys: .*PUSH_APNS_BUNDLE_ID PUSH_APNS_KEY_ID PUSH_APNS_KEY_P8 PUSH_APNS_TEAM_ID '
  check "silent push: the FCM keys go to the Secret" log_has '^secret-keys: .*PUSH_FCM_PROJECT_ID PUSH_FCM_SERVICE_ACCOUNT_JSON '
  check "silent push: the API is told" log_has 'env\.SILENT_PUSH_ENABLED=true'
  check "silent push: on and says which channels" out_has 'widget silent pushes: on \(APNs on, FCM on\)'
  check "silent push: no value on a command line or printed" silent_push_hidden
}

run "silent push fcm only" SILENT_PUSH_ENABLED=1 PUSH_FCM_PROJECT_ID=fcm-proj-1 PUSH_FCM_SERVICE_ACCOUNT_JSON="$SP_JSON" SKIP_BUILD=1 && {
  check "silent push: one channel is enough" out_has 'widget silent pushes: on \(APNs off, FCM on\)'
  check "silent push: no APNs key in the Secret" log_lacks '^secret-keys: .*PUSH_APNS_'
}

printf 'DB_HOST=db.example.test\nPUSH_FCM_PROJECT_ID=fcm-proj-1\nPUSH_FCM_SERVICE_ACCOUNT_JSON=%s\n' "$SP_JSON" > "$WORK/sp-secret"
run "silent push keys kept" STUB_SECRET_FILE="$WORK/sp-secret" SKIP_BUILD=1 && {
  check "silent push: keys left out keep what the Secret has" log_has '^secret-keys: .*PUSH_FCM_PROJECT_ID PUSH_FCM_SERVICE_ACCOUNT_JSON '
  check "silent push: a deploy without the flag keeps it off" log_has 'env\.SILENT_PUSH_ENABLED=false'
  check "silent push: kept values are never printed" silent_push_hidden
}
run "silent push keys removed" STUB_SECRET_FILE="$WORK/sp-secret" PUSH_FCM_PROJECT_ID= PUSH_FCM_SERVICE_ACCOUNT_JSON= SKIP_BUILD=1 && {
  check "silent push: keys set to empty are removed" log_lacks '^secret-keys: .*PUSH_FCM_'
}

for key in PUSH_APNS_KEY_ID PUSH_APNS_TEAM_ID PUSH_APNS_KEY_P8 PUSH_APNS_BUNDLE_ID PUSH_FCM_PROJECT_ID PUSH_FCM_SERVICE_ACCOUNT_JSON; do
  check "silent push: values/api.yaml maps $key from the Secret (optional)" \
    bash -c "grep -A3 '^  $key:' '$HERE/values/api.yaml' | grep -q 'key: $key' && grep -A3 '^  $key:' '$HERE/values/api.yaml' | grep -q 'optional: true'"
done

run "no demo key" SKIP_BUILD=1 && {
  check "demo: off without a key, and says so" out_has 'try-it demo: off'
  check "demo: no DEMO_SIGNING_KEY in the Secret" log_lacks '^secret-keys: .*DEMO_SIGNING_KEY'
}

EXPECT_FAIL=1 run "short demo key" DEMO_SIGNING_KEY=short SKIP_BUILD=1
check "demo: a short key is refused" out_has 'DEMO_SIGNING_KEY is shorter than 32'

run "demo on" DEMO_SIGNING_KEY=abcdefghijklmnopqrstuvwxyz0123456789 SKIP_BUILD=1 && {
  check "demo: on, and says so" out_has 'try-it demo: on'
  check "demo: the key goes to the Secret" log_has '^secret-keys: .*DEMO_SIGNING_KEY'
  check "demo: the value is never printed" out_lacks 'abcdefghijklmnopqrstuvwxyz0123456789'
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

# Bring your own database: the Stores__* settings go to the Secret only and reach the API as secretEnv references.
store_secret_hidden() { ! grep -qF -- "$KEK_A" "$WORK/log" "$WORK/out" && ! grep -qF -- "$KEK_B" "$WORK/log" "$WORK/out" \
  && ! grep -qF -- 'owner-sub-1' "$WORK/out"; }

run "own database off by default" SKIP_BUILD=1 && {
  check "own database: off and says so" out_has 'own database: off'
  check "own database: no Stores__ key in the Secret" log_lacks '^secret-keys: .*Stores__'
  check "own database: no Stores__ variable on the API" log_lacks 'secretEnv\.Stores__'
}

run "own database on" Stores__Enabled=true Stores__CurrentKeyId=k1 Stores__KeyEncryptionKeys__k1="$KEK_A" \
  Stores__Allowlist='owner-sub-1, 3f2b1c9e-0000-4000-8000-000000000001' SKIP_BUILD=1 && {
  check "own database: on, with counts only" out_has 'own database: on \(1 key\(s\), 2 allowlisted account\(s\)\)'
  check "own database: the keys go to the Secret" \
    log_has '^secret-keys: .*Stores__Allowlist__0 Stores__Allowlist__1 Stores__CurrentKeyId Stores__Enabled Stores__KeyEncryptionKeys__k1 '
  check "own database: the API reads the key from the Secret" \
    log_has 'secretEnv\.Stores__KeyEncryptionKeys__k1\.secretName=lotties-secrets --set-string secretEnv\.Stores__KeyEncryptionKeys__k1\.key=Stores__KeyEncryptionKeys__k1'
  check "own database: the flag is a Secret reference, not a plain env value" \
    bash -c "grep -q 'secretEnv\.Stores__Enabled\.key=Stores__Enabled' '$WORK/log' && ! grep -q 'env\.Stores__' <(grep -v secretEnv '$WORK/log')"
  check "own database: no key or allowlist value is on a command line or printed" store_secret_hidden
}

run "own database dry run" DRY_RUN=1 DRY_RUN_DIR="$WORK/rendered-byo" Stores__Enabled=true Stores__CurrentKeyId=k1 \
  Stores__KeyEncryptionKeys__k1="$KEK_A" SKIP_BUILD=1 && {
  check "own database dry run: nothing secret is printed" store_secret_hidden
  check "own database dry run: the Secret keys are listed by name" out_has 'keys: .*Stores__KeyEncryptionKeys__k1'
}

EXPECT_FAIL=1 run "own database without a current key" Stores__Enabled=true Stores__KeyEncryptionKeys__k1="$KEK_A" SKIP_BUILD=1
check "own database: on without Stores__CurrentKeyId stops the run" out_has 'Stores__Enabled=true needs Stores__CurrentKeyId'
check "own database: it stops before anything is changed" log_lacks '(create secret generic|^helm )'

EXPECT_FAIL=1 run "own database without its key" Stores__Enabled=true Stores__CurrentKeyId=k2 Stores__KeyEncryptionKeys__k1="$KEK_A" SKIP_BUILD=1
check "own database: a current key id without its key stops the run" out_has 'needs Stores__KeyEncryptionKeys__k2'

EXPECT_FAIL=1 run "own database short key" Stores__Enabled=true Stores__CurrentKeyId=k1 Stores__KeyEncryptionKeys__k1=c2hvcnQ= SKIP_BUILD=1
check "own database: a key that is not 32 bytes stops the run" out_has 'Stores__KeyEncryptionKeys__k1 must be base64 of exactly 32 bytes'
check "own database: the bad key is not printed" out_lacks 'c2hvcnQ='

EXPECT_FAIL=1 run "own database bad flag" Stores__Enabled=yes SKIP_BUILD=1
check "own database: a flag that is not true or false stops the run" out_has 'Stores__Enabled must be true or false'

EXPECT_FAIL=1 run "own database bad key id" Stores__Enabled=true Stores__CurrentKeyId=K1 SKIP_BUILD=1
check "own database: an upper-case key id stops the run" out_has 'Stores__CurrentKeyId is not 1 to 32 lower-case'

printf 'DB_HOST=db.example.test\nStores__Enabled=true\nStores__CurrentKeyId=k2\nStores__KeyEncryptionKeys__k1=%s\nStores__KeyEncryptionKeys__k2=%s\nStores__Allowlist__0=owner-sub-1\n' \
  "$KEK_A" "$KEK_B" > "$WORK/cluster-secret"
run "own database keeps the Secret's keys" STUB_SECRET_FILE="$WORK/cluster-secret" SKIP_BUILD=1 && {
  check "keep: an old key and the current one stay in the Secret" \
    log_has '^secret-keys: .*Stores__KeyEncryptionKeys__k1 Stores__KeyEncryptionKeys__k2 '
  check "keep: the allowlist and the flag stay" log_has '^secret-keys: .*Stores__Allowlist__0 Stores__CurrentKeyId Stores__Enabled '
  check "keep: on, from the Secret" out_has 'own database: on \(2 key\(s\), 1 allowlisted account\(s\)\)'
  check "keep: nothing secret is printed" store_secret_hidden
}

run "own database removes a key set to empty" STUB_SECRET_FILE="$WORK/cluster-secret" Stores__KeyEncryptionKeys__k1= \
  Stores__Allowlist= SKIP_BUILD=1 && {
  check "remove: the emptied key is gone, the current one stays" \
    bash -c "grep -E '^secret-keys: ' '$WORK/log' | grep -q 'Stores__KeyEncryptionKeys__k2' && ! grep -E '^secret-keys: ' '$WORK/log' | grep -q 'Stores__KeyEncryptionKeys__k1'"
  check "remove: an empty allowlist clears it" log_lacks '^secret-keys: .*Stores__Allowlist__'
}

EXPECT_FAIL=1 run "own database cannot read the Secret" STUB_SECRET_FAIL=1 SKIP_BUILD=1
check "own database: a Secret that cannot be read stops the run (its keys would be lost)" out_has 'could not read Secret lotties-secrets'
check "own database: nothing is applied then" log_lacks 'create secret generic'

# The cluster-specific settings have no defaults: without them the run stops before calling anything.
: > "$WORK/log"
env -i PATH="$WORK/bin:$PATH" HOME="$WORK" STUB_LOG="$WORK/log" ENV_FILE="$WORK/app.env" TAG_RELEASE=0 SKIP_BUILD=1 \
  bash "$DEPLOY" > "$WORK/out" 2>&1 < /dev/null
RUN_CODE=$?
check "deploy settings: none set stops the run" bash -c "[ $RUN_CODE -ne 0 ]"
check "deploy settings: every missing one is named" \
  out_has 'missing deploy settings: REGISTRY KUBE_CONTEXT INGRESS_CLASS PULL_SECRET CLUSTER_ISSUER \(set it empty for no certificate\)'
check "deploy settings: nothing is called before the check" bash -c "[ ! -s '$WORK/log' ]"

EXPECT_FAIL=1 run "registry placeholder" REGISTRY='<registry-host>/<project>' SKIP_BUILD=1
check "deploy settings: the .env.example placeholder is refused" out_has 'REGISTRY is still the \.env\.example placeholder'

EXPECT_FAIL=1 run "bad registry" REGISTRY='https://reg.test/lotties' SKIP_BUILD=1
check "deploy settings: a registry with a scheme is refused" out_has "REGISTRY 'https://reg\.test/lotties' must be"

EXPECT_FAIL=1 run "pull secret missing, no source namespace" STUB_PULL_SECRET=no PULL_SECRET_SOURCE_NS= SKIP_BUILD=1
check "pull secret: without a source namespace a missing one stops the run" bash -c "[ $RUN_CODE -ne 0 ]"
check "pull secret: the create command is shown" out_has 'create secret docker-registry pull-test --from-file=\.dockerconfigjson=\./pull-auth\.json'
check "pull secret: nothing is copied" log_lacks ' -n shared-ns '

run "no issuer, no source namespace, dry run" DRY_RUN=1 DRY_RUN_DIR="$WORK/rendered-bare" CLUSTER_ISSUER= PULL_SECRET_SOURCE_NS= \
  STUB_PULL_SECRET=no SKIP_BUILD=1 && {
  check "dry run: a missing pull Secret without a source is a warning" out_has 'warning: Secret pull-test is missing in lotties-app-production'
}

exit "$FAILED"
