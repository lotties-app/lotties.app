#!/usr/bin/env bash
# Builds the theme carrier image from deploy/out/theme (run package-theme.sh first).
#   bash code/keycloak-theme/deploy/build-image.sh                     -> lotties-keycloak-theme:<version>
#   IMAGE_REPO=registry.example.com/apps/lotties-keycloak-theme bash build-image.sh
#   PUSH=1 IMAGE_REPO=... bash build-image.sh                          -> also pushes (route B, you logged in before)
#   MULTI=1 bash build-image.sh   -> lotties-keycloak-themes:<version> (all folders of out/themes, see package-multi.sh)
#   CONTAINER_CLI=docker bash build-image.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
CLI="${CONTAINER_CLI:-podman}"
if [ "${MULTI:-0}" = 1 ]; then   # shared-IdP layout: image with several theme folders
  REPO="${IMAGE_REPO:-localhost/lotties-keycloak-themes}"; CF=Containerfile.multi-image
  [ -d "$HERE/out/themes" ] || bash "$HERE/package-multi.sh"
else
  REPO="${IMAGE_REPO:-localhost/lotties-keycloak-theme}"; CF=Containerfile.image
fi
VERSION="${VERSION:-$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$HERE/../package.json" | head -n1)}"
[ "${MULTI:-0}" = 1 ] || [ -d "$HERE/out/theme/lotties/login" ] || { echo "Run package-theme.sh first." >&2; exit 1; }

"$CLI" build --network host --build-arg "VERSION=$VERSION" -t "$REPO:$VERSION" -f "$HERE/$CF" "$HERE"
echo "Built $REPO:$VERSION"
if [ "${PUSH:-0}" = "1" ]; then
  "$CLI" push "$REPO:$VERSION"
  echo "Pushed $REPO:$VERSION"
fi
