#!/usr/bin/env bash
# Proves the multi-theme layout (values-theme-multi-oci.yaml) locally: the whole themes/ directory is one volume
# filled from the multi image (run package-multi.sh + MULTI=1 build-image.sh first), Keycloak 26.0.5 Bitnami image,
# production-like flags. Creates two clients in the throwaway realm, each with its own login theme
# (client attribute login_theme): br-app-a -> lotties, br-app-b -> example-other-app.
# Then: node verify-bitnami-shots.mjs  with CLIENT=br-app-a|br-app-b.  Cleanup: verify-bitnami-local.sh down.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
CLI="${CONTAINER_CLI:-podman}"
IMG="${THEMES_IMAGE:-localhost/lotties-keycloak-themes:$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$HERE/../package.json" | head -n1)}"
SEC=(--user 1001:1001 --read-only --cap-drop ALL --security-opt no-new-privileges)
"$CLI" rm -f br-kc-bn >/dev/null 2>&1 || true
"$CLI" volume rm -f br-kc-bn-theme >/dev/null 2>&1 || true
"$CLI" volume create br-kc-bn-theme >/dev/null
"$CLI" run --rm "${SEC[@]}" -v br-kc-bn-theme:/target "$IMG"
THEME_DIR=br-kc-bn-theme THEME_TARGET=/opt/bitnami/keycloak/themes bash "$HERE/verify-bitnami-local.sh" up | grep -E "Keycloak up|realm import|done|Nothing"
# shellcheck disable=SC1091
source "$HERE/.runtime/bn.env"
BASE="http://localhost:${PORT:-8086}"
TOKEN="$(printf '%s' "$KC_ADMIN_PASSWORD" | curl -fsS --data-urlencode client_id=admin-cli --data-urlencode grant_type=password \
  --data-urlencode username=admin --data-urlencode "password@/dev/stdin" "$BASE/realms/master/protocol/openid-connect/token" | jq -r .access_token)"
for pair in br-app-a:lotties br-app-b:example-other-app; do
  cid="${pair%%:*}"; theme="${pair##*:}"
  jq -n --arg c "$cid" --arg t "$theme" '{clientId:$c,enabled:true,publicClient:true,standardFlowEnabled:true,
      redirectUris:["http://localhost:5190/*"],attributes:{"pkce.code.challenge.method":"S256",login_theme:$t}}' |
    curl -sS -o /dev/null -w "client $cid (login_theme=$theme) HTTP %{http_code}\n" -H @<(printf 'Authorization: Bearer %s\n' "$TOKEN") \
      -H 'Content-Type: application/json' -d @- "$BASE/admin/realms/babyroutine-dev/clients"
done
echo "--- built-in themes still available (serverinfo login themes):"
curl -fsS -H @<(printf 'Authorization: Bearer %s\n' "$TOKEN") "$BASE/admin/serverinfo" | jq -c '.themes.login | map(.name)'
echo "--- admin console (keycloak.v2 from the jar) HTTP:"
curl -s -o /dev/null -w '%{http_code}\n' "$BASE/admin/master/console/"
for c in br-app-a br-app-b; do
  curl -fsS "$BASE/realms/babyroutine-dev/protocol/openid-connect/auth?client_id=$c&redirect_uri=http%3A%2F%2Flocalhost%3A5190%2F&response_type=code&scope=openid&code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&code_challenge_method=S256" |
    grep -o '"resourcesPath": "[^"]*"' | head -n1 | sed "s#^#$c #"
done
