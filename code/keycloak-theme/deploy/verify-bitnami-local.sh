#!/usr/bin/env bash
# Local, throwaway proof that the theme directory works on the SAME image as the Kubernetes install:
# docker.io/bitnamilegacy/keycloak:26.0.5-debian-12-r0, started the way the Bitnami chart runs it
# (production mode behind a proxy, read-only root filesystem, writable emptyDir-like volumes, theme mounted :ro at
# /opt/bitnami/keycloak/themes/lotties). Containers/volumes are named br-kc-bn*; nothing else is touched.
# Never contacts any cluster. Passwords are generated here (deploy/.runtime, gitignored) and never printed.
#
#   bash verify-bitnami-local.sh up        # start container, create the throwaway realm, configure-realm.sh dry-run/apply/re-apply
#   bash verify-bitnami-local.sh check     # assert the login page uses the theme (en and pt-BR)
#   bash verify-bitnami-local.sh restart   # restart the container, assert again (theme survives)
#   bash verify-bitnami-local.sh down      # remove br-kc-bn and its volumes
# Env: MODE=prod (default; production flags + --read-only) | dev (KEYCLOAK_PRODUCTION=false), PORT=8086,
#      KC_IMAGE=docker.io/bitnamilegacy/keycloak:26.0.5-debian-12-r0 (fallback: quay.io/keycloak/keycloak:26.0.5, see README of this folder)
# Screenshots: node verify-bitnami-shots.mjs (Playwright from tests/e2e/node_modules).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
CLI="${CONTAINER_CLI:-podman}"
NAME=br-kc-bn
PORT="${PORT:-8086}"
MGMT_PORT="${MGMT_PORT:-9086}"
MODE="${MODE:-prod}"
KC_IMAGE="${KC_IMAGE:-docker.io/bitnamilegacy/keycloak:26.0.5-debian-12-r0}"
# THEME_TARGET=/opt/bitnami/keycloak/themes mounts a whole multi-theme volume (verify-multi.sh).
# THEME_DIR may also be a podman volume name (used by verify-init-routes.sh).
THEME_DIR="${THEME_DIR:-$HERE/out/theme/lotties}"
REALM_FILE="$HERE/../dev/realm-lotties-dev.json"
REALM=lotties-dev
BASE="http://localhost:$PORT"
VOLS=(conf lib-quarkus data providers bitnami)

mkdir -p "$HERE/.runtime"
if [ ! -f "$HERE/.runtime/bn.env" ]; then
  ( umask 077; echo "KC_ADMIN_PASSWORD=$(openssl rand -hex 16)" > "$HERE/.runtime/bn.env" )
fi
# shellcheck disable=SC1091
source "$HERE/.runtime/bn.env"

wait_ready() {
  for _ in $(seq 1 120); do
    if curl -fs "$BASE/realms/master" >/dev/null 2>&1; then return 0; fi
    sleep 2
  done
  echo "Keycloak did not become ready; last log lines:" >&2
  "$CLI" logs --tail 40 "$NAME" >&2 || true
  return 1
}

run_container() {
  local args=(run -d --name "$NAME" --network host
    -e KEYCLOAK_ADMIN=admin -e KEYCLOAK_ADMIN_PASSWORD="$KC_ADMIN_PASSWORD"
    -e KEYCLOAK_HTTP_PORT="$PORT" -e KC_HTTP_MANAGEMENT_PORT="$MGMT_PORT"
    -e KEYCLOAK_DATABASE_VENDOR=dev-file
    -v "$THEME_DIR:${THEME_TARGET:-/opt/bitnami/keycloak/themes/lotties}:ro")
  if [ "$MODE" = prod ]; then
    # Mirrors the chart: production, proxy headers, TLS terminated outside, read-only root filesystem, and the
    # chart's `empty-dir` mounts (named volumes here; podman seeds them from the image like the prepare-write-dirs init container).
    args+=(-e KEYCLOAK_PRODUCTION=true -e KC_HTTP_ENABLED=true -e KC_HOSTNAME_STRICT=false -e KC_PROXY_HEADERS=xforwarded
      --read-only --user 1001:1001 --cap-drop ALL --security-opt no-new-privileges
      --tmpfs /tmp
      -v br-kc-bn-conf:/opt/bitnami/keycloak/conf
      -v br-kc-bn-lib-quarkus:/opt/bitnami/keycloak/lib/quarkus
      -v br-kc-bn-data:/opt/bitnami/keycloak/data
      -v br-kc-bn-providers:/opt/bitnami/keycloak/providers
      -v br-kc-bn-bitnami:/bitnami/keycloak)
  else
    args+=(-e KEYCLOAK_PRODUCTION=false)
  fi
  "$CLI" "${args[@]}" "$KC_IMAGE" >/dev/null
}

token() {
  printf '%s' "$KC_ADMIN_PASSWORD" | curl -fsS --data-urlencode client_id=admin-cli --data-urlencode grant_type=password \
    --data-urlencode username=admin --data-urlencode "password@/dev/stdin" \
    "$BASE/realms/master/protocol/openid-connect/token" | jq -r .access_token
}

login_url() { echo "$BASE/realms/$REALM/protocol/openid-connect/auth?client_id=baby-routine-web&redirect_uri=http%3A%2F%2Flocalhost%3A5190%2F&response_type=code&scope=openid&code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&code_challenge_method=S256&kc_locale=$1"; }

check() {
  local ok=1 loc html
  for loc in en pt-BR; do
    html="$(curl -fsS "$(login_url "$loc")")"
    if grep -q "/login/lotties/dist/assets/" <<<"$html"; then
      echo "PASS login page ($loc) references the lotties theme assets"
    else
      echo "FAIL login page ($loc) does not use the theme"; ok=0
    fi
  done
  local js
  js="$(grep -o '/resources/[^"]*/login/lotties/dist/assets/index-[^"]*\.js' <<<"$html" | head -n1 || true)"
  if [ -n "$js" ] && [ "$(curl -s -o /dev/null -w '%{http_code}' "$BASE$js")" = 200 ]; then
    echo "PASS theme script is served (200): $js"
  else
    echo "FAIL theme script not served ($js)"; ok=0
  fi
  [ "$ok" = 1 ]
}

case "${1:-}" in
  up)
    case "$THEME_DIR" in /*) [ -d "$THEME_DIR/login" ] ;; *) true ;; esac || { echo "Run package-theme.sh first." >&2; exit 1; }
    "$CLI" rm -f "$NAME" >/dev/null 2>&1 || true
    for v in "${VOLS[@]}"; do "$CLI" volume rm -f "br-kc-bn-$v" >/dev/null 2>&1 || true; done
    run_container
    wait_ready
    echo "Keycloak up ($MODE mode, $KC_IMAGE) on $BASE"
    TOKEN="$(token)"
    # Realm without a login theme: configure-realm.sh must set it.
    jq 'del(.loginTheme) | del(.internationalizationEnabled) | del(.supportedLocales) | del(.defaultLocale)' "$REALM_FILE" > "$HERE/.runtime/realm.json"
    code="$(curl -sS -o /dev/null -w '%{http_code}' -H @<(printf 'Authorization: Bearer %s\n' "$TOKEN") -H 'Content-Type: application/json' \
      -d @"$HERE/.runtime/realm.json" "$BASE/admin/realms")"
    echo "realm import HTTP $code (201 expected)"
    export KC_URL="$BASE" KC_REALM="$REALM" KC_ADMIN_USER=admin KC_ADMIN_PASSWORD
    echo "--- configure-realm.sh --dry-run"; bash "$HERE/configure-realm.sh" --dry-run
    echo "--- configure-realm.sh";           bash "$HERE/configure-realm.sh"
    echo "--- configure-realm.sh (again, must be a no-op)"; bash "$HERE/configure-realm.sh"
    ;;
  check) check ;;
  restart)
    "$CLI" restart "$NAME" >/dev/null
    sleep 3
    wait_ready
    check
    ;;
  down)
    "$CLI" rm -f "$NAME" >/dev/null 2>&1 || true
    for v in "${VOLS[@]}"; do "$CLI" volume rm -f "br-kc-bn-$v" >/dev/null 2>&1 || true; done
    echo "removed $NAME and br-kc-bn-* volumes"
    ;;
  *) sed -n 2,14p "$0"; exit 2 ;;
esac
