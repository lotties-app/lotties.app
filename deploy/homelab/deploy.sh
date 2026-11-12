#!/usr/bin/env bash
# Deploys Lotties to a Kubernetes cluster (the owner's home lab): the API (.NET 10) and the web app (React SPA on
# nginx) in namespace lotties-app-production, public at https://lotties.app through an Ingress.
#
# Run as root inside WSL, from anywhere:
#   ./deploy/homelab/deploy.sh             settings from deploy/homelab/.env (copy .env.example)
#   DRY_RUN=1 ./deploy/homelab/deploy.sh   changes nothing: read-only checks, the plan, the rendered manifests
#
# Where to deploy (environment, or deploy/homelab/.env; a variable set in the environment wins over the file). The
# cluster-specific ones are required and have no default: the script stops before doing anything when one is not set.
#   REGISTRY        Required. Registry host and project of the images, e.g. registry.example.com/lotties (images
#                   lotties-api, lotties-web).
#   KUBE_CONTEXT    Required. Kube context, always passed to kubectl and helm (e.g. my-cluster). KUBECONFIG is used as
#                   usual. KUBE_CONTEXT=in-cluster: a pod's own service account (a CI runner).
#   INGRESS_CLASS   Required. Ingress class of the public entry (e.g. traefik).
#   CLUSTER_ISSUER  Required, may be empty. cert-manager ClusterIssuer (e.g. letsencrypt-production); empty: no certificate.
#   PULL_SECRET     Required. Name of the docker-registry Secret the pods pull the images with (e.g. registry-pull).
#   PULL_SECRET_SOURCE_NS  Optional. A namespace that already holds PULL_SECRET: when it is missing in NS, it is copied
#                   from there. Empty: a missing pull Secret stops the run with the command to create it.
#   NS              Namespace. Default lotties-app-production; created when missing.
#   PUBLIC_HOST     Default lotties.app: / is the web app, /api the API.
#   TLS_SECRET      Secret the certificate is issued into. Default lotties-tls.
#   TAG             One tag for both images (both are rebuilt). Default: per-image source tags src-<hash>.
#   FORCE_BUILD=1   Rebuild even when the registry already has the tag.
#   SKIP_BUILD=1    Build nothing; the tags must already be in the registry.
#   VERSION         The release, vX.Y.Z (the v is optional). Left out, a run that built something takes the patch after
#                   the highest vX.Y.Z among the git tags and the registry tags. The images also get it and latest as tags.
#                   It is chosen before the builds: an image built in this run carries it with the short commit and the
#                   build time (build args APP_VERSION, APP_COMMIT, APP_BUILD_TIME; Hub > About, GET /api/v1/version).
#                   They are not part of the source tag: an image that is not rebuilt keeps the release that built it.
#                   To have both images carry the same release (About shows one number), rebuild both: FORCE_BUILD=1
#                   (pods restart; the src-<hash> tags stay the same, the images are pushed again under them).
#   TAG_RELEASE=0   Do not create the annotated git tag vX.Y.Z on HEAD after a release. PUSH_TAG=0: create it but do not push it.
#   COPY_PULL_SECRET=1  When PULL_SECRET is missing in NS, copy it from PULL_SECRET_SOURCE_NS without asking.
#   DRY_RUN=1       Builds, pushes, creates and installs nothing. Renders the manifests into DRY_RUN_DIR (default: a new
#                   temporary directory) and checks them with kubectl apply --dry-run=client.
#
# App settings (see .env.example): AUTH_AUTHORITY, AUTH_AUDIENCE, VITE_OIDC_*, VITE_REPO_URL, VITE_ISSUES_URL,
# VITE_SUPPORT_URL and VITE_PRIVACY_* (public, baked into the web image), DB_*, PUSH_VAPID_*, DEMO_SIGNING_KEY, AUTH_ADMIN_CLIENT_*, PUSH_APNS_* and PUSH_FCM_* (the Secret lotties-secrets), DB_AUTO_MIGRATE,
# SILENT_PUSH_ENABLED (default false), CORS_ALLOWED_ORIGINS.
#
# Bring your own database (docs/DEPLOY.md "Bring your own database: turning it on"; off by default). Every one of these
# goes only to the Secret lotties-secrets (never a ConfigMap, a values file or a command line; values are never printed)
# and reaches the API pod as the environment variable of the same name:
#   Stores__Enabled                  true turns the feature on. Default false (left out: the Secret's value is kept).
#   Stores__Allowlist                Comma-separated accounts (users.id guid or OIDC sub, at most 100) that may use it,
#                                    stored as Stores__Allowlist__0, __1, ... Left out keeps the Secret's list; empty clears it.
#   Stores__CurrentKeyId             The id of the key every new seal uses (1 to 32 lower-case letters, digits or dashes).
#   Stores__KeyEncryptionKeys__<id>  A key-encryption key: base64 of exactly 32 bytes (openssl rand -base64 32). In .env the
#                                    id is letters and digits only (a shell name). A key already in the Secret is kept unless
#                                    set to empty here: never remove one that still seals a row (DEPLOY.md "Rotating a key").
# With Stores__Enabled=true the run stops before changing anything when Stores__CurrentKeyId is missing or malformed, when
# its key is missing, or when any key is not base64 of 32 bytes (messages name key ids only, never key material).
#
# Only what changed is built: each image is tagged src-<hash> of the files it is built from (working tree included, and
# for the web image the VITE_* values). A tag already in the registry is not rebuilt and its pods are not restarted.
#
# Secret values are never printed: the Secret is built from files in a private temporary directory. The repository
# root .env (docker compose) is never read.
set -euo pipefail

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO=$(cd "$HERE/../.." && pwd)
CHART="$HERE/charts/lotties-app"
APP_SECRET=lotties-secrets

# Files each image is built from (repository-relative pathspecs). The API image uses only these from its context
# (code/api/.dockerignore leaves the tests out); the web image takes its whole context.
API_SOURCES=(code/api/Dockerfile code/api/.dockerignore code/api/Directory.Build.props code/api/src code/api/data)
WEB_SOURCES=(code/web ':(exclude)code/web/dist' ':(exclude)code/web/node_modules' ':(exclude)code/web/coverage')

# ── Pure helpers (deploy.test.sh checks them) ─────────────────────────────────

# Reads KEY=value lines (no code is run) and exports each key that is not already set. Quotes around a value are removed.
load_env_file() { # file
  local line key value
  [ -f "$1" ] || return 0
  while IFS= read -r line || [ -n "$line" ]; do
    line=${line%$'\r'}
    line="${line#"${line%%[![:space:]]*}"}"
    case "$line" in ''|'#'*) continue ;; esac
    line=${line#export }
    key=${line%%=*}
    key="${key%"${key##*[![:space:]]}"}"
    value=${line#*=}
    # A space or a tab around the value (or after it) is never part of it: a secret with one is a wrong secret.
    value="${value#"${value%%[![:space:]]*}"}"; value="${value%"${value##*[![:space:]]}"}"
    [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue
    value=${value#\"}; value=${value%\"}; value=${value#\'}; value=${value%\'}
    [ -n "${!key+x}" ] || export "$key=$value"
  done < "$1"
}

# src-<12 hex>: hash of every listed file's path and working-tree content (tracked and untracked, not .gitignored),
# plus a salt (build arguments that change the image).
source_tag() { # salt pathspecs...
  local salt=$1 files
  shift
  files=$(cd "$REPO" && git ls-files --cached --others --exclude-standard -- "$@" | sort -u \
    | while IFS= read -r file; do [ -f "$file" ] && printf '%s\n' "$file"; done)
  # An empty list means git could not be read here (a git worktree made on Windows cannot be read from WSL, for example): every image would get the
  # same tag and a stale image in the registry would be deployed. Stop instead.
  [ -n "$files" ] || { echo "error: git listed no files under $* in $REPO: cannot compute the image tag. Run from a normal clone (not a git worktree), or set TAG." >&2; exit 1; }
  printf 'src-%s' "$( { (cd "$REPO" && paste <(printf '%s\n' "$files") <(printf '%s\n' "$files" | git hash-object --stdin-paths)); printf '%s\n' "$salt"; } \
    | sha256sum | cut -c1-12)"
}
image_tag() { if [ -n "${TAG:-}" ]; then printf '%s' "$TAG"; else source_tag "$@"; fi; }

# The web build arguments, one per line: a changed value is a different image.
web_build_salt() {
  printf 'VITE_API_BASE_URL=%s\nVITE_OIDC_AUTHORITY=%s\nVITE_OIDC_CLIENT_ID=%s\nVITE_OIDC_AUDIENCE=%s\nVITE_REPO_URL=%s\n' \
    "$VITE_API_BASE_URL" "$VITE_OIDC_AUTHORITY" "$VITE_OIDC_CLIENT_ID" "$VITE_OIDC_AUDIENCE" "$VITE_REPO_URL"
  printf 'VITE_PRIVACY_CONTROLLER_NAME=%s\nVITE_PRIVACY_CONTACT_EMAIL=%s\nVITE_PRIVACY_DPO=%s\n' \
    "$VITE_PRIVACY_CONTROLLER_NAME" "$VITE_PRIVACY_CONTACT_EMAIL" "$VITE_PRIVACY_DPO"
  printf 'VITE_ISSUES_URL=%s\nVITE_SUPPORT_URL=%s\n' "$VITE_ISSUES_URL" "$VITE_SUPPORT_URL"
  printf 'VITE_TESTFLIGHT_URL=%s\nVITE_ANDROID_TESTERS_GROUP_URL=%s\nVITE_ANDROID_OPTIN_URL=%s\nVITE_PLAY_STORE_URL=%s\n' \
    "$VITE_TESTFLIGHT_URL" "$VITE_ANDROID_TESTERS_GROUP_URL" "$VITE_ANDROID_OPTIN_URL" "$VITE_PLAY_STORE_URL"
}

# The next release X.Y.Z (no v) after the tags on standard input; only vX.Y.Z tags count, none at all gives 1.0.0.
bump_version() { # [patch|minor|major]
  local bump=${1:-patch} latest major minor patch
  case "$bump" in
    patch | minor | major) ;;
    *) echo "bump must be patch, minor or major, not '$bump'" >&2; return 1 ;;
  esac
  latest=$(grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | sed 's/^v//' | sort -t. -k1,1n -k2,2n -k3,3n | tail -n 1 || true)
  if [ -z "$latest" ]; then echo "1.0.0"; return 0; fi
  IFS=. read -r major minor patch <<< "$latest"
  case "$bump" in
    major) echo "$((major + 1)).0.0" ;;
    minor) echo "$major.$((minor + 1)).0" ;;
    patch) echo "$major.$minor.$((patch + 1))" ;;
  esac
}

# The build arguments that stamp the release into an image, one per line (both images get the same three): the
# release number X.Y.Z (empty: the app shows "dev"), the short commit and the build time. They are never part of the
# source tag: a new release number alone does not make an image different, so an unchanged image is not rebuilt and
# keeps the number of the release that built it. FORCE_BUILD=1 rebuilds both, so both carry the new release.
release_build_args() { # version commit built-at
  printf -- '--build-arg\nAPP_VERSION=%s\n--build-arg\nAPP_COMMIT=%s\n--build-arg\nAPP_BUILD_TIME=%s\n' "${1#v}" "$2" "$3"
}

# true or false for true/false (any case) and 1/0, as the API reads DB_AUTO_MIGRATE; anything else fails.
parse_bool() { # value
  case "$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')" in
    '' | false | 0) echo false ;;
    true | 1) echo true ;;
    *) return 1 ;;
  esac
}

# Whether a value still contains a <placeholder> of .env.example.
is_placeholder() { local pattern='<[a-z][a-z0-9@._/-]*>'; [[ "$1" =~ $pattern ]]; }

# Bring your own database: a key id as the API accepts it, and a key-encryption key (padded base64 of exactly 32 bytes).
is_store_key_id() { [[ "$1" =~ ^[a-z0-9][a-z0-9-]{0,31}$ ]]; }
is_store_kek() { [[ "$1" =~ ^[A-Za-z0-9+/]{42}[AEIMQUYcgkosw048]=$ ]]; }

# The entries of a comma-separated list, one per line, without the spaces around them; empty entries are dropped.
split_list() { # list
  local entry entries
  IFS=, read -r -a entries <<< "$1"
  for entry in "${entries[@]}"; do
    entry="${entry#"${entry%%[![:space:]]*}"}"; entry="${entry%"${entry##*[![:space:]]}"}"
    [ -z "$entry" ] || printf '%s\n' "$entry"
  done
}

# A value for helm --set-string: a comma or a backslash would otherwise be read as syntax.
helm_escape() { local value=${1//\\/\\\\}; printf '%s' "${value//,/\\,}"; }

# ── Cluster, registry and output helpers ──────────────────────────────────────
step() { printf '\n==> %s\n' "$*"; }
die() { echo "error: $*" >&2; exit 1; }
dry() { [ "${DRY_RUN:-0}" = 1 ]; }
would() { echo "[dry run] would $*"; }

# Every kubectl / helm call names the context: the shared kubeconfig's current context can point anywhere.
k() { if [ "$CONTEXT" = in-cluster ]; then kubectl "$@"; else kubectl --context "$CONTEXT" "$@"; fi; }
kube() { k -n "$NS" "$@"; }
helm_ns() { if [ "$CONTEXT" = in-cluster ]; then helm -n "$NS" "$@"; else helm --kube-context "$CONTEXT" -n "$NS" "$@"; fi; }
secret_value() { # namespace secret key -> decoded value, empty when missing
  k -n "$1" get secret "$2" -o "jsonpath={.data['$3']}" 2>/dev/null | base64 -d 2>/dev/null || true
}

# ── Settings ──────────────────────────────────────────────────────────────────
# The cluster-specific settings belong to whoever runs the deploy, never to the repository: they have no default. Every
# one that is not set is listed at once, before anything is checked or changed; a .env.example <placeholder> is refused.
require_deploy_settings() {
  local key missing=()
  for key in REGISTRY KUBE_CONTEXT INGRESS_CLASS PULL_SECRET; do
    [ -n "${!key:-}" ] || missing+=("$key")
  done
  [ -n "${CLUSTER_ISSUER+x}" ] || missing+=("CLUSTER_ISSUER (set it empty for no certificate)")
  [ "${#missing[@]}" -eq 0 ] \
    || die "missing deploy settings: ${missing[*]}. Set them in deploy/homelab/.env (see deploy/homelab/.env.example)"
  for key in REGISTRY KUBE_CONTEXT INGRESS_CLASS CLUSTER_ISSUER PULL_SECRET PULL_SECRET_SOURCE_NS; do
    ! is_placeholder "${!key:-}" || die "$key is still the .env.example placeholder"
  done
}

configure() {
  require_deploy_settings
  CONTEXT=$KUBE_CONTEXT
  CONTAINER_TOOL=${CONTAINER_TOOL:-$(command -v podman >/dev/null 2>&1 && echo podman || echo docker)}
  NS=${NS:-lotties-app-production}
  PUBLIC_HOST=${PUBLIC_HOST:-lotties.app}
  PULL_SECRET_SOURCE_NS=${PULL_SECRET_SOURCE_NS:-}
  TLS_SECRET=${TLS_SECRET:-lotties-tls}
  VERSION=${VERSION:-}
  VERSION=${VERSION#v}
  AUTH_AUTHORITY=${AUTH_AUTHORITY:-https://auth.lotties.app/realms/lotties.app}
  AUTH_AUDIENCE=${AUTH_AUDIENCE:-lotties-api}
  VITE_OIDC_AUTHORITY=${VITE_OIDC_AUTHORITY:-$AUTH_AUTHORITY}
  VITE_OIDC_CLIENT_ID=${VITE_OIDC_CLIENT_ID:-}
  VITE_OIDC_AUDIENCE=${VITE_OIDC_AUDIENCE:-}
  VITE_API_BASE_URL=${VITE_API_BASE_URL:-}
  VITE_REPO_URL=${VITE_REPO_URL:-}
  # Footer links (public; empty = the default report link, or hidden; docs/DEPLOY.md).
  VITE_ISSUES_URL=${VITE_ISSUES_URL:-}
  VITE_SUPPORT_URL=${VITE_SUPPORT_URL:-}
  # Phone app beta links on the landing page (public; empty hides each part; docs/DEPLOY.md "Phone app links").
  VITE_TESTFLIGHT_URL=${VITE_TESTFLIGHT_URL:-}
  VITE_ANDROID_TESTERS_GROUP_URL=${VITE_ANDROID_TESTERS_GROUP_URL:-}
  VITE_ANDROID_OPTIN_URL=${VITE_ANDROID_OPTIN_URL:-}
  VITE_PLAY_STORE_URL=${VITE_PLAY_STORE_URL:-}
  # Privacy policy contacts (public; empty = the policy's defaults, docs/PRIVACY-OWNER-CHECKLIST.md).
  VITE_PRIVACY_CONTROLLER_NAME=${VITE_PRIVACY_CONTROLLER_NAME:-}
  VITE_PRIVACY_CONTACT_EMAIL=${VITE_PRIVACY_CONTACT_EMAIL:-}
  VITE_PRIVACY_DPO=${VITE_PRIVACY_DPO:-}
  FORWARDED_HEADERS_TRUSTED_NETWORKS=${FORWARDED_HEADERS_TRUSTED_NETWORKS:-}
  # Browser origins allowed to call the API. Default: the web app only. The iOS/Android app (code/mobile) adds its
  # WebView origins: https://$PUBLIC_HOST,https://localhost,capacitor://localhost (docs/design/12-mobile-capacitor.md).
  CORS_ALLOWED_ORIGINS=${CORS_ALLOWED_ORIGINS:-https://$PUBLIC_HOST}
  # Where the web pod's nginx would send /api/ (the Ingress sends /api to the API directly).
  API_UPSTREAM="lotties-api.$NS.svc.cluster.local:8080"
  DB_AUTO_MIGRATE=$(parse_bool "${DB_AUTO_MIGRATE:-false}") || die "DB_AUTO_MIGRATE must be true or false"
  # Widget silent pushes: off unless set (a deploy without it turns them off); on only once privacy policy 14 is live.
  SILENT_PUSH_ENABLED=$(parse_bool "${SILENT_PUSH_ENABLED:-false}") || die "SILENT_PUSH_ENABLED must be true or false"
  BUILT=0
  WOULD_BUILD=0

  [[ "$NS" =~ ^[a-z0-9]([-a-z0-9]*[a-z0-9])?$ ]] || die "NS '$NS' is not a valid namespace name"
  [[ "$PUBLIC_HOST" =~ ^[a-z0-9]([-a-z0-9.]*[a-z0-9])?$ ]] || die "PUBLIC_HOST '$PUBLIC_HOST' is not a host name"
  [[ "$REGISTRY" =~ ^[a-z0-9.-]+(:[0-9]+)?(/[a-z0-9._-]+)*$ ]] || die "REGISTRY '$REGISTRY' must be <host>[:port][/<project>] (e.g. registry.example.com/lotties)"
  [[ "$INGRESS_CLASS$TLS_SECRET$CLUSTER_ISSUER$PULL_SECRET" =~ ^[a-z0-9.-]+$ ]] \
    || die "INGRESS_CLASS, TLS_SECRET, CLUSTER_ISSUER and PULL_SECRET must be resource names"
  [[ -z "$PULL_SECRET_SOURCE_NS" || "$PULL_SECRET_SOURCE_NS" =~ ^[a-z0-9]([-a-z0-9]*[a-z0-9])?$ ]] \
    || die "PULL_SECRET_SOURCE_NS '$PULL_SECRET_SOURCE_NS' is not a valid namespace name"
  [ -n "$VITE_OIDC_CLIENT_ID" ] || die "set VITE_OIDC_CLIENT_ID (the public SPA client id) in deploy/homelab/.env"
  ! is_placeholder "$VITE_OIDC_CLIENT_ID" || die "VITE_OIDC_CLIENT_ID is still the .env.example placeholder"
  [[ "$AUTH_AUTHORITY" =~ ^https?:// && "$VITE_OIDC_AUTHORITY" =~ ^https?:// ]] || die "AUTH_AUTHORITY and VITE_OIDC_AUTHORITY must be http(s) URLs"
  [[ "$CORS_ALLOWED_ORIGINS" =~ ^[a-z][a-z0-9+.-]*://[^,/[:space:]]+(,[a-z][a-z0-9+.-]*://[^,/[:space:]]+)*$ ]] \
    || die "CORS_ALLOWED_ORIGINS must be comma-separated origins (scheme://host[:port], no path or spaces)"

  API_TAG=$(image_tag "" "${API_SOURCES[@]}")
  WEB_TAG=$(image_tag "$(web_build_salt)" "${WEB_SOURCES[@]}")
  WORK=$(mktemp -d)
  chmod 700 "$WORK"
  OUT=${DRY_RUN_DIR:-$WORK/rendered}
  dry && OUT=${DRY_RUN_DIR:-$(mktemp -d)}
  mkdir -p "$OUT"
}

checks() {
  local tool
  step "Checks (context $CONTEXT, namespace $NS, registry $REGISTRY$(dry && echo ', DRY RUN: nothing is changed'))"
  for tool in kubectl helm envsubst git sha256sum base64; do
    command -v "$tool" >/dev/null 2>&1 || die "$tool is not installed"
  done
  if [ "$CONTEXT" != in-cluster ]; then
    kubectl config get-contexts "$CONTEXT" >/dev/null 2>&1 || {
      echo "error: kube context '$CONTEXT' does not exist. Set KUBE_CONTEXT to one of:" >&2
      kubectl config get-contexts -o name >&2
      exit 1
    }
    k cluster-info >/dev/null
  fi
  [ "${SKIP_BUILD:-0}" = 1 ] && return 0
  command -v "$CONTAINER_TOOL" >/dev/null 2>&1 || die "$CONTAINER_TOOL is not installed"
  [ "$CONTAINER_TOOL" = podman ] || return 0
  # Credentials are stored under the key given to `podman login`: the host, or host/project (robot accounts).
  podman login --get-login "${REGISTRY%%/*}" >/dev/null 2>&1 || podman login --get-login "$REGISTRY" >/dev/null 2>&1 && return 0
  dry && { echo "warning: not logged in to ${REGISTRY%%/*}: a real run needs podman login ${REGISTRY%%/*}"; return 0; }
  die "not logged in to ${REGISTRY%%/*} or $REGISTRY: run podman login ${REGISTRY%%/*}"
}

# ── Secret of the API ─────────────────────────────────────────────────────────
# A value comes from the environment or .env; a key that is not set there keeps what the Secret already has. A key set
# to an empty value is removed. Each value is written to its own file in a private directory, never to a command line.
setting_or_secret() { # key
  if [ -n "${!1+x}" ]; then printf '%s' "${!1}"; else secret_value "$NS" "$APP_SECRET" "$1"; fi
}
put_secret() { # key value
  [ -n "$2" ] || return 0
  ! is_placeholder "$2" || die "$1 is still the .env.example placeholder"
  ( umask 077; printf '%s' "$2" > "$SECRET_DIR/$1" )
}
secret_keys() { (cd "$SECRET_DIR" && ls | tr '\n' ' '); }
# The Stores__* keys the Secret already has, one per line (none when it does not exist yet). Any other failure to read it
# stops the run: the keys left out of a run are removed from the Secret, and a lost key-encryption key loses families' data.
existing_store_keys() {
  local listed
  if listed=$(k -n "$NS" get secret "$APP_SECRET" -o 'go-template={{range $key, $value := .data}}{{$key}}{{"\n"}}{{end}}' 2>&1); then
    printf '%s\n' "$listed" | grep -E '^Stores__' || true
    return 0
  fi
  [[ "$listed" == *NotFound* || "$listed" == *"not found"* ]] \
    || die "could not read Secret $APP_SECRET to keep its Stores__* keys (kubectl failed); nothing was changed"
}

# The allowlist, one entry per line: from Stores__Allowlist (comma-separated) when it is set, else what the Secret has.
store_allowlist() { # existing keys
  local key
  if [ -n "${Stores__Allowlist+x}" ]; then split_list "$Stores__Allowlist"; return 0; fi
  printf '%s\n' "$1" | grep -E '^Stores__Allowlist__[0-9]+$' | sort -t_ -k5,5n | while IFS= read -r key; do
    secret_value "$NS" "$APP_SECRET" "$key"
    printf '\n'
  done
}

# A key-encryption key from the environment or .env (when its id makes a shell name), else from the Secret.
store_kek() { # key
  if [[ "$1" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then setting_or_secret "$1"; else secret_value "$NS" "$APP_SECRET" "$1"; fi
}

# Bring your own database (see the header): the flag, the allowlist and the keys, all into the Secret, values never printed.
collect_store_secrets() {
  local enabled current key id value existing count=0 keys=0
  existing=$(existing_store_keys)
  enabled=$(parse_bool "$(setting_or_secret Stores__Enabled)") || die "Stores__Enabled must be true or false"
  [ "$enabled" = false ] || put_secret Stores__Enabled true
  while IFS= read -r value; do
    [ -n "$value" ] || continue
    [[ "$value" =~ ^[^[:space:],]+$ ]] || die "Stores__Allowlist entry $count has a space or a comma in it"
    put_secret "Stores__Allowlist__$count" "$value"
    count=$((count + 1))
  done < <(store_allowlist "$existing")
  [ "$count" -le 100 ] || die "Stores__Allowlist has $count entries; the API takes at most 100"
  current=$(setting_or_secret Stores__CurrentKeyId)
  [ -z "$current" ] || is_store_key_id "$current" || die "Stores__CurrentKeyId is not 1 to 32 lower-case letters, digits or dashes"
  put_secret Stores__CurrentKeyId "$current"
  # Keys set here (environment or .env) and keys only in the Secret (kept); a key set to empty here is removed.
  for key in $( { compgen -e; printf '%s\n' "$existing"; } | grep -E '^Stores__KeyEncryptionKeys__' | sort -u); do
    id=${key#Stores__KeyEncryptionKeys__}
    is_store_key_id "$id" || die "$key: the key id is not 1 to 32 lower-case letters, digits or dashes"
    value=$(store_kek "$key")
    [ -n "$value" ] || continue
    ! is_placeholder "$value" || die "$key is still the .env.example placeholder"
    is_store_kek "$value" || die "$key must be base64 of exactly 32 bytes (openssl rand -base64 32)"
    put_secret "$key" "$value"
    keys=$((keys + 1))
  done
  if [ "$enabled" = false ]; then
    echo "own database: off (Stores__Enabled is not true)$([ "$keys" -eq 0 ] || echo "; $keys key(s) kept in the Secret")"
    return 0
  fi
  [ -n "$current" ] || die "Stores__Enabled=true needs Stores__CurrentKeyId (the id of the key new seals use)"
  [ -f "$SECRET_DIR/Stores__KeyEncryptionKeys__$current" ] \
    || die "Stores__Enabled=true needs Stores__KeyEncryptionKeys__$current (named by Stores__CurrentKeyId): base64 of 32 bytes"
  echo "own database: on ($keys key(s), $count allowlisted account(s))"
}

collect_secrets() {
  local key value demo_key push_count=0 admin_count=0 apns_count=0 fcm_count=0 missing=()
  step "Secret $APP_SECRET (values are not shown)"
  SECRET_DIR="$WORK/secret"
  mkdir -m 700 "$SECRET_DIR"
  for key in DB_HOST DB_PORT DB_NAME DB_APP_USER DB_APP_PASSWORD; do
    value=$(setting_or_secret "$key")
    case "$key" in DB_PORT) value=${value:-5432} ;; DB_NAME) value=${value:-lotties} ;; esac
    [ -n "$value" ] || missing+=("$key")
    put_secret "$key" "$value"
  done
  for key in PUSH_VAPID_PUBLIC_KEY PUSH_VAPID_PRIVATE_KEY PUSH_VAPID_SUBJECT; do
    value=$(setting_or_secret "$key")
    [ -z "$value" ] || push_count=$((push_count + 1))
    put_secret "$key" "$value"
  done
  # The try-it demo (docs/design/45-try-it-demo.md): one optional signing key; without it the demo is off.
  demo_key=$(setting_or_secret DEMO_SIGNING_KEY)
  [ -z "$demo_key" ] || [ "${#demo_key}" -ge 32 ] || die "DEMO_SIGNING_KEY is shorter than 32 characters (the minimum the API accepts)"
  put_secret DEMO_SIGNING_KEY "$demo_key"
  # The Keycloak service account that deletes the sign-in account with the Lotties account (docs/KEYCLOAK-ACCOUNT-DELETION.md).
  for key in AUTH_ADMIN_CLIENT_ID AUTH_ADMIN_CLIENT_SECRET; do
    value=$(setting_or_secret "$key")
    [ -z "$value" ] || admin_count=$((admin_count + 1))
    put_secret "$key" "$value"
  done
  # Silent pushes for the widgets (docs/design/37b-widget-silent-push.md): APNs (three, all or none; the bundle id is
  # optional) and FCM (both or none). SILENT_PUSH_ENABLED (not a secret) turns them on; see releases().
  for key in PUSH_APNS_KEY_ID PUSH_APNS_TEAM_ID PUSH_APNS_KEY_P8 PUSH_APNS_BUNDLE_ID PUSH_FCM_PROJECT_ID PUSH_FCM_SERVICE_ACCOUNT_JSON; do
    value=$(setting_or_secret "$key")
    case "$key" in
      PUSH_APNS_BUNDLE_ID) ;;
      PUSH_APNS_*) [ -z "$value" ] || apns_count=$((apns_count + 1)) ;;
      PUSH_FCM_*) [ -z "$value" ] || fcm_count=$((fcm_count + 1)) ;;
    esac
    put_secret "$key" "$value"
  done
  collect_store_secrets
  if [ "$DB_AUTO_MIGRATE" = true ]; then
    for key in DB_MIGRATOR_USER DB_MIGRATOR_PASSWORD; do
      value=$(setting_or_secret "$key")
      [ -n "$value" ] || missing+=("$key (needed by DB_AUTO_MIGRATE=true)")
      put_secret "$key" "$value"
    done
  fi
  [ "${#missing[@]}" -eq 0 ] || die "missing settings: ${missing[*]} (set them in deploy/homelab/.env)"
  case "$push_count" in 0 | 3) ;; *) die "set all three PUSH_VAPID_* values or none (push is off with none)" ;; esac
  case "$admin_count" in 0 | 2) ;; *) die "set both AUTH_ADMIN_CLIENT_ID and AUTH_ADMIN_CLIENT_SECRET or neither (with neither, deleting an account keeps the Keycloak user)" ;; esac
  case "$apns_count" in 0 | 3) ;; *) die "set all three of PUSH_APNS_KEY_ID, PUSH_APNS_TEAM_ID and PUSH_APNS_KEY_P8 or none" ;; esac
  case "$fcm_count" in 0 | 2) ;; *) die "set both PUSH_FCM_PROJECT_ID and PUSH_FCM_SERVICE_ACCOUNT_JSON or neither" ;; esac
  [ "$SILENT_PUSH_ENABLED" = false ] || [ "$apns_count" = 3 ] || [ "$fcm_count" = 2 ] \
    || die "SILENT_PUSH_ENABLED=true needs the PUSH_APNS_* or the PUSH_FCM_* values (the API does not start without a channel)"
  # A pod reads its Secret only when it starts: the API pods carry this checksum, so a changed Secret restarts them.
  SECRETS_HASH=$( (cd "$SECRET_DIR" && for key in *; do printf '%s\n' "$key"; cat "$key"; printf '\n'; done) | sha256sum | cut -c1-16)
  echo "keys: $(secret_keys)"
  [ "$push_count" = 3 ] && echo "push notifications: on" || echo "push notifications: off (no PUSH_VAPID_* values)"
  [ -n "$demo_key" ] && echo "try-it demo: on" || echo "try-it demo: off (no DEMO_SIGNING_KEY)"
  [ "$admin_count" = 2 ] && echo "account deletion: also deletes the Keycloak user" \
    || echo "account deletion: keeps the Keycloak user (no AUTH_ADMIN_CLIENT_* values; see docs/KEYCLOAK-ACCOUNT-DELETION.md)"
  if [ "$SILENT_PUSH_ENABLED" = true ]; then
    echo "widget silent pushes: on (APNs $([ "$apns_count" = 3 ] && echo on || echo off), FCM $([ "$fcm_count" = 2 ] && echo on || echo off))"
  else
    echo "widget silent pushes: off (SILENT_PUSH_ENABLED is not true)"
  fi
  [ "$DB_AUTO_MIGRATE" = true ] && echo "DB_AUTO_MIGRATE=true: the API pod holds the migrator credentials" || true
}

apply_secret() {
  if dry; then would "apply Secret $APP_SECRET in $NS with keys: $(secret_keys)"; return 0; fi
  kube create secret generic "$APP_SECRET" --from-file="$SECRET_DIR" --dry-run=client -o yaml \
    | kubectl label --local -f - app.kubernetes.io/part-of=lotties -o yaml \
    | kube apply --server-side --force-conflicts --field-manager=lotties-deploy -f - >/dev/null
  echo "Secret $APP_SECRET applied"
}

# ── Namespace and pull Secret ─────────────────────────────────────────────────
render() { # manifest -> stdout, ${NS} ${PUBLIC_HOST} ${INGRESS_CLASS} ${CLUSTER_ISSUER} ${TLS_SECRET} substituted
  export NS PUBLIC_HOST INGRESS_CLASS CLUSTER_ISSUER TLS_SECRET
  if [ -n "$CLUSTER_ISSUER" ]; then
    envsubst '${NS} ${PUBLIC_HOST} ${INGRESS_CLASS} ${CLUSTER_ISSUER} ${TLS_SECRET}' < "$HERE/manifests/$1"
  else
    envsubst '${NS} ${PUBLIC_HOST} ${INGRESS_CLASS} ${CLUSTER_ISSUER} ${TLS_SECRET}' < "$HERE/manifests/$1" \
      | sed '/^ *cert-manager\.io\/cluster-issuer:/d'
  fi
}

ensure_namespace() {
  step "Namespace $NS"
  render namespace.yaml > "$OUT/namespace.yaml"
  if k get namespace "$NS" >/dev/null 2>&1; then echo "exists"; return 0; fi
  if dry; then would "create it:"; k apply --dry-run=client -f "$OUT/namespace.yaml"; return 0; fi
  k apply -f "$OUT/namespace.yaml"
}

pull_secret_hint() {
  local ctx=""
  [ "$CONTEXT" = in-cluster ] || ctx="--context $CONTEXT "
  if [ -z "$PULL_SECRET_SOURCE_NS" ]; then
    cat <<EOF
Create it from a login of an account that can pull ${REGISTRY} (or set PULL_SECRET_SOURCE_NS to a namespace that has it):
  podman login --authfile ./pull-auth.json ${REGISTRY%%/*}
  kubectl ${ctx}-n $NS create secret docker-registry $PULL_SECRET --from-file=.dockerconfigjson=./pull-auth.json
  rm ./pull-auth.json
EOF
    return 0
  fi
  cat <<EOF
Copy it from namespace $PULL_SECRET_SOURCE_NS with COPY_PULL_SECRET=1, or by hand:
  kubectl ${ctx}-n $PULL_SECRET_SOURCE_NS get secret $PULL_SECRET -o jsonpath='{.data.\.dockerconfigjson}' | base64 -d \\
    | kubectl ${ctx}-n $NS create secret docker-registry $PULL_SECRET --from-file=.dockerconfigjson=/dev/stdin
EOF
}

copy_pull_secret() {
  k -n "$PULL_SECRET_SOURCE_NS" get secret "$PULL_SECRET" -o 'jsonpath={.data.\.dockerconfigjson}' | base64 -d \
    | kube create secret docker-registry "$PULL_SECRET" --from-file=.dockerconfigjson=/dev/stdin >/dev/null
  echo "copied $PULL_SECRET from $PULL_SECRET_SOURCE_NS"
}

ensure_pull_secret() {
  local type answer
  step "Image pull Secret $PULL_SECRET"
  type=$(kube get secret "$PULL_SECRET" -o 'jsonpath={.type}' 2>/dev/null || true)
  # Pods can only pull with a docker-registry Secret; any other type leaves them in ImagePullBackOff.
  if [ "$type" = kubernetes.io/dockerconfigjson ]; then echo "present"; return 0; fi
  [ -z "$type" ] || die "Secret $PULL_SECRET in $NS has type $type, not kubernetes.io/dockerconfigjson: delete it and re-run"
  if [ -z "$PULL_SECRET_SOURCE_NS" ]; then
    if dry; then echo "warning: Secret $PULL_SECRET is missing in $NS: a real run stops here (no PULL_SECRET_SOURCE_NS to copy it from)"; pull_secret_hint; return 0; fi
    echo "error: Secret $PULL_SECRET is missing in $NS." >&2; pull_secret_hint >&2; exit 1
  fi
  [ "$(k -n "$PULL_SECRET_SOURCE_NS" get secret "$PULL_SECRET" -o 'jsonpath={.type}' 2>/dev/null || true)" = kubernetes.io/dockerconfigjson ] \
    || die "Secret $PULL_SECRET is missing in $NS and in $PULL_SECRET_SOURCE_NS: create it (see deploy/homelab/README.md)"
  if dry; then would "copy $PULL_SECRET from namespace $PULL_SECRET_SOURCE_NS into $NS (COPY_PULL_SECRET=1 or a yes)"; return 0; fi
  if [ "${COPY_PULL_SECRET:-0}" != 1 ]; then
    [ -t 0 ] || { echo "Secret $PULL_SECRET is missing in $NS." >&2; pull_secret_hint >&2; exit 1; }
    read -r -p "Secret $PULL_SECRET is missing in $NS. Copy it from namespace $PULL_SECRET_SOURCE_NS? [y/N] " answer
    [[ "$answer" =~ ^[yY] ]] || { pull_secret_hint >&2; exit 1; }
  fi
  copy_pull_secret
}

# ── Images ────────────────────────────────────────────────────────────────────
in_registry() { # name tag
  if [ "$CONTAINER_TOOL" = podman ]; then
    podman search --list-tags --limit 10000 --format '{{.Tag}}' "$REGISTRY/$1" 2>/dev/null | grep -qx -- "$2"
  else
    "$CONTAINER_TOOL" manifest inspect "$REGISTRY/$1:$2" >/dev/null 2>&1
  fi
}

push() { # image: the registry sometimes answers a layer upload with 500; retry before giving up
  local attempt
  for attempt in 1 2 3; do
    "$CONTAINER_TOOL" push -q "$1" && return 0
    [ "$attempt" -lt 3 ] && { echo "push failed (attempt $attempt), retrying in 10 s" >&2; sleep 10; }
  done
  return 1
}

# Whether an image must be built. A fixed TAG is a request to rebuild under that tag; a source tag already pushed
# means nothing changed.
needs_build() { # name tag
  [ -n "${TAG:-}" ] || [ "${FORCE_BUILD:-0}" = 1 ] || ! in_registry "$1" "$2"
}

build_push() { # name tag needed(0/1) dockerfile context [build args...]
  local image="$REGISTRY/$1:$2" needed=$3 dockerfile=$4 context=$5
  shift 5
  step "Image $image"
  if [ "$needed" != 1 ]; then
    echo "unchanged, already in the registry: not rebuilt"
    return 0
  fi
  if dry; then
    WOULD_BUILD=1
    would "build and push it: $CONTAINER_TOOL build --network host -t $image -f ${dockerfile#"$REPO/"} $* ${context#"$REPO/"}"
    return 0
  fi
  "$CONTAINER_TOOL" build --network host -q -t "$image" -f "$dockerfile" "$@" "$context" | tail -1
  push "$image"
  BUILT=1
}

# The versions (vX.Y.Z) the registry has for an image, one per line. Only podman can list the tags of a registry.
registry_versions() { # name
  [ "$CONTAINER_TOOL" = podman ] || return 0
  podman search --list-tags --limit 10000 --format '{{.Tag}}' "$REGISTRY/$1" 2>/dev/null | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' || true
}

# The next release: the patch after the highest vX.Y.Z in git and in the registry, so a deploy never reuses a number.
next_version() {
  { (cd "$REPO" && git tag -l 'v*' 2>/dev/null) || true; registry_versions lotties-api; registry_versions lotties-web; } | bump_version patch
}

# The deployed image also gets the release as a tag (v1.0.7) and latest; the pods keep running the source tag, so a
# release that did not change an image does not restart it.
tag_version() { # name tag
  [ -n "$VERSION" ] || return 0
  local source="$REGISTRY/$1:$2" alias
  "$CONTAINER_TOOL" image inspect "$source" >/dev/null 2>&1 || "$CONTAINER_TOOL" pull -q "$source" >/dev/null
  for alias in "v$VERSION" latest; do
    "$CONTAINER_TOOL" tag "$source" "$REGISTRY/$1:$alias"
    push "$REGISTRY/$1:$alias"
  done
}

images() {
  if [ "${SKIP_BUILD:-0}" = 1 ]; then
    step "Images: SKIP_BUILD=1, using $REGISTRY/lotties-api:$API_TAG and $REGISTRY/lotties-web:$WEB_TAG"
    return 0
  fi
  local api_needed=0 web_needed=0 stamp
  needs_build lotties-api "$API_TAG" && api_needed=1
  needs_build lotties-web "$WEB_TAG" && web_needed=1
  # A run that builds something is a new release; one that builds nothing (or was given a fixed TAG) is not. The
  # number is chosen before the builds so the images can carry it (APP_VERSION); the tags still come from the sources.
  if [ -z "$VERSION" ] && [ -z "${TAG:-}" ] && [ "$api_needed$web_needed" != 00 ]; then
    VERSION=$(next_version)
    dry && would "tag the images v$VERSION and latest" || echo "New release v$VERSION (the next after the tags in git and in the registry)"
  fi
  mapfile -t stamp < <(release_build_args "$VERSION" "$(cd "$REPO" && git rev-parse --short=12 HEAD 2>/dev/null || true)" \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)")
  build_push lotties-api "$API_TAG" "$api_needed" "$REPO/code/api/Dockerfile" "$REPO/code/api" "${stamp[@]}"
  # The VITE_* values are public (they end up in the JavaScript bundle).
  build_push lotties-web "$WEB_TAG" "$web_needed" "$REPO/code/web/Dockerfile" "$REPO/code/web" "${stamp[@]}" \
    --build-arg "VITE_API_BASE_URL=$VITE_API_BASE_URL" \
    --build-arg "VITE_OIDC_AUTHORITY=$VITE_OIDC_AUTHORITY" \
    --build-arg "VITE_OIDC_CLIENT_ID=$VITE_OIDC_CLIENT_ID" \
    --build-arg "VITE_OIDC_AUDIENCE=$VITE_OIDC_AUDIENCE" \
    --build-arg "VITE_REPO_URL=$VITE_REPO_URL" \
    --build-arg "VITE_ISSUES_URL=$VITE_ISSUES_URL" \
    --build-arg "VITE_SUPPORT_URL=$VITE_SUPPORT_URL" \
    --build-arg "VITE_TESTFLIGHT_URL=$VITE_TESTFLIGHT_URL" \
    --build-arg "VITE_ANDROID_TESTERS_GROUP_URL=$VITE_ANDROID_TESTERS_GROUP_URL" \
    --build-arg "VITE_ANDROID_OPTIN_URL=$VITE_ANDROID_OPTIN_URL" \
    --build-arg "VITE_PLAY_STORE_URL=$VITE_PLAY_STORE_URL" \
    --build-arg "VITE_PRIVACY_CONTROLLER_NAME=$VITE_PRIVACY_CONTROLLER_NAME" \
    --build-arg "VITE_PRIVACY_CONTACT_EMAIL=$VITE_PRIVACY_CONTACT_EMAIL" \
    --build-arg "VITE_PRIVACY_DPO=$VITE_PRIVACY_DPO"
  dry && return 0
  tag_version lotties-api "$API_TAG"
  tag_version lotties-web "$WEB_TAG"
}

# ── Releases and the Ingress ──────────────────────────────────────────────────
release() { # release values-file image tag [helm args...]
  local name=$1 values=$2 image=$3 tag=$4 args
  shift 4
  args=("$name" "$CHART" -f "$HERE/values/$values.yaml" --set-string "image.repository=$REGISTRY/$image" --set-string "image.tag=$tag"
    --set-string "imagePullSecrets[0].name=$PULL_SECRET")
  [ -z "$VERSION" ] || args+=(--set-string "appVersion=v$VERSION")
  args+=("$@")
  step "Release $name ($REGISTRY/$image:$tag)"
  if dry; then
    helm_ns template "${args[@]}" > "$OUT/$name.yaml"
    would "helm upgrade --install $name (rendered: $OUT/$name.yaml)"
    k apply --dry-run=client -f "$OUT/$name.yaml"
    return 0
  fi
  helm_ns upgrade --install "${args[@]}" --wait --timeout 10m
}

releases() {
  local api_args=(
    --set-string "env.AUTH_AUTHORITY=$(helm_escape "$AUTH_AUTHORITY")"
    --set-string "env.AUTH_AUDIENCE=$(helm_escape "$AUTH_AUDIENCE")"
    --set-string "env.CORS_ALLOWED_ORIGINS=$(helm_escape "$CORS_ALLOWED_ORIGINS")"
    --set-string "env.DB_AUTO_MIGRATE=$DB_AUTO_MIGRATE"
    --set-string "env.SILENT_PUSH_ENABLED=$SILENT_PUSH_ENABLED"
    --set-string "podAnnotations.checksum/secrets=$SECRETS_HASH"
  )
  [ -z "$FORWARDED_HEADERS_TRUSTED_NETWORKS" ] \
    || api_args+=(--set-string "env.FORWARDED_HEADERS_TRUSTED_NETWORKS=$(helm_escape "$FORWARDED_HEADERS_TRUSTED_NETWORKS")")
  # Bring your own database: each Stores__* key of the Secret becomes the API's variable of the same name (names only).
  local key
  for key in $(cd "$SECRET_DIR" && ls | grep -E '^Stores__' || true); do
    api_args+=(--set-string "secretEnv.$key.secretName=$APP_SECRET" --set-string "secretEnv.$key.key=$key")
  done
  release lotties-api api lotties-api "$API_TAG" "${api_args[@]}"
  release lotties-web web lotties-web "$WEB_TAG" --set-string "env.API_UPSTREAM=$API_UPSTREAM"
}

apply_ingress() {
  step "Ingress https://$PUBLIC_HOST (class $INGRESS_CLASS, issuer ${CLUSTER_ISSUER:-none}, TLS Secret $TLS_SECRET)"
  render ingress.yaml > "$OUT/ingress.yaml"
  if dry; then k apply --dry-run=client -f "$OUT/ingress.yaml"; return 0; fi
  k apply -f "$OUT/ingress.yaml"
}

summary() {
  local ctx=""
  [ "$CONTEXT" = in-cluster ] || ctx="--context $CONTEXT "
  step "Done"
  if dry; then
    echo "Dry run: nothing was built, pushed, created or installed. Rendered manifests: $OUT"
    return 0
  fi
  kube get pods -l app.kubernetes.io/part-of=lotties
  kube get certificate "$TLS_SECRET" 2>/dev/null || true
  echo
  echo "App  https://$PUBLIC_HOST      API  https://$PUBLIC_HOST/api/v1"
  if [ -n "$VERSION" ]; then
    echo "Release v$VERSION (images tagged v$VERSION and latest)."
    tag_release "$VERSION"
  fi
  echo "Roll back one release: helm ${ctx}-n $NS rollback lotties-api   (or lotties-web)"
}

# Marks the release in git: an annotated vX.Y.Z tag on HEAD, pushed to origin. Never fails the deploy (it is already live): a problem
# is printed with the command to run by hand. A tag that exists is left alone. Uncommitted changes are built into the images
# (the source tags count the working tree), so the tag then points at the nearest commit and the output says so.
tag_release() {
  local version=$1 dirty=""
  [ "${TAG_RELEASE:-1}" = 1 ] || return 0
  if (cd "$REPO" && git rev-parse -q --verify "refs/tags/v$version" >/dev/null 2>&1); then
    echo "Git tag v$version already exists: left as it is."
    return 0
  fi
  [ -z "$(cd "$REPO" && git status --porcelain 2>/dev/null)" ] || dirty=" (the working tree had uncommitted changes: the images may hold more than that commit)"
  if ! (cd "$REPO" && git tag -a "v$version" -m "Release $version" 2>/dev/null); then
    echo "Could not create the git tag. By hand: git tag -a v$version -m \"Release $version\"" >&2
    return 0
  fi
  echo "Git tag v$version created on $(cd "$REPO" && git rev-parse --short=12 HEAD)$dirty."
  [ "${PUSH_TAG:-1}" = 1 ] || return 0
  if (cd "$REPO" && git remote get-url origin >/dev/null 2>&1); then
    (cd "$REPO" && git push -q origin "refs/tags/v$version" 2>/dev/null)       && echo "Git tag v$version pushed to origin."       || echo "Could not push the tag. By hand: git push origin v$version" >&2
  fi
}

cleanup() { [ -z "${WORK:-}" ] || rm -rf "$WORK"; }

main() {
  load_env_file "${ENV_FILE:-$HERE/.env}"
  trap cleanup EXIT
  configure
  checks
  # Every setting is checked before anything is created or built.
  collect_secrets
  ensure_namespace
  ensure_pull_secret
  images
  apply_secret
  releases
  apply_ingress
  summary
}

# Sourced (deploy.test.sh), only the functions are defined.
if [ "${BASH_SOURCE[0]}" = "$0" ]; then main "$@"; fi
