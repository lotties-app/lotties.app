#!/usr/bin/env bash
# Builds the theme jar inside a container (Node 22 + JDK + Maven) and copies it to ./dist_keycloak.
# Works with podman (default) or docker: CONTAINER_CLI=docker bash build-in-podman.sh
# KC_TARGETS=all bash build-in-podman.sh   also builds the jars for Keycloak 22-25.
set -euo pipefail
cd "$(dirname "$0")"

CLI="${CONTAINER_CLI:-podman}"
IMAGE="br-kc-theme-builder"
CONTAINER="br-kc-theme-build-$$"

# --network host: rootful bridge networks do not work in some WSL setups; harmless elsewhere.
"$CLI" build --network host --build-arg "KC_TARGETS=${KC_TARGETS:-}" -t "$IMAGE" -f Containerfile .

rm -rf dist_keycloak
mkdir -p dist_keycloak
"$CLI" create --name "$CONTAINER" "$IMAGE" >/dev/null
trap '"$CLI" rm -f "$CONTAINER" >/dev/null 2>&1 || true' EXIT
"$CLI" cp "$CONTAINER:/app/dist_keycloak/." dist_keycloak/

echo "Built:"
ls -la dist_keycloak/*.jar
