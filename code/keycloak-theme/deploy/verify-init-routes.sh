#!/usr/bin/env bash
# Local proof of delivery routes A and C with the production-like securityContext (uid 1001, read-only root fs, no caps):
#   A: the theme image copies /theme into a volume (what the init container of values-theme-oci.yaml does)
#   C: curlimages/curl downloads lotties-theme.tar.gz from a local HTTP server, checks the sha256 (a wrong
#      checksum must fail) and unpacks it (what values-theme-url.yaml does)
# Then Keycloak (verify-bitnami-local.sh, MODE=prod) mounts that volume read-only at .../themes/lotties.
# Run package-theme.sh and build-image.sh first. Names: br-kc-bn-theme (volume), br-kc-bn-http (file server).
#   bash verify-init-routes.sh A|C
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
CLI="${CONTAINER_CLI:-podman}"
ROUTE="${1:?A or C}"
VOL=br-kc-bn-theme
IMG="${THEME_IMAGE:-localhost/lotties-keycloak-theme:$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$HERE/../package.json" | head -n1)}"
SEC=(--user 1001:1001 --read-only --cap-drop ALL --security-opt no-new-privileges)

"$CLI" rm -f br-kc-bn-http >/dev/null 2>&1 || true
"$CLI" volume rm -f "$VOL" >/dev/null 2>&1 || true
"$CLI" volume create "$VOL" >/dev/null
trap '"$CLI" rm -f br-kc-bn-http >/dev/null 2>&1 || true' EXIT

if [ "$ROUTE" = A ]; then
  "$CLI" run --rm "${SEC[@]}" -v "$VOL:/target" "$IMG" sh -c 'cp -R /theme/. /target/ && echo lotties theme copied'
else
  "$CLI" volume rm -f br-kc-bn-theme-dl >/dev/null 2>&1 || true
  "$CLI" volume create br-kc-bn-theme-dl >/dev/null
  # A throwaway static file server (own container) for the tarball.
  "$CLI" run -d --name br-kc-bn-http --network host -v "$HERE/out:/srv:ro" docker.io/library/python:3.12-alpine \
    python -m http.server 8087 --directory /srv >/dev/null
  sleep 3
  SHA="$(cut -d' ' -f1 "$HERE/out/lotties-theme.tar.gz.sha256")"
  fetch() { # fetch <sha256>
    "$CLI" run --rm --network host "${SEC[@]}" -v "$VOL:/target" -v br-kc-bn-theme-dl:/dl \
      -e THEME_URL=http://localhost:8087/lotties-theme.tar.gz -e THEME_SHA256="$1" \
      docker.io/curlimages/curl:8.11.1 sh -ec '
        curl -fsSL --retry 3 --retry-delay 2 --max-time 120 -o /dl/theme.tar.gz "$THEME_URL"
        echo "$THEME_SHA256  /dl/theme.tar.gz" | sha256sum -c -
        tar -xzf /dl/theme.tar.gz -C /target --strip-components=1
        test -f /target/login/theme.properties
        echo "lotties theme installed"'
  }
  echo "--- wrong checksum (must fail)"
  if fetch 0000000000000000000000000000000000000000000000000000000000000000; then echo "FAIL: wrong checksum accepted" >&2; exit 1; fi
  echo "PASS wrong checksum rejected"
  echo "--- right checksum"
  fetch "$SHA"
  "$CLI" volume rm -f br-kc-bn-theme-dl >/dev/null 2>&1 || true
fi

echo "--- volume content"
"$CLI" run --rm "${SEC[@]}" -v "$VOL:/t:ro" docker.io/library/busybox:1.37.0 sh -c 'ls -ln /t /t/login | head -12; test -f /t/login/theme.properties && echo "theme.properties present"'
