#!/usr/bin/env bash
# Starts a throwaway Keycloak (dev mode, port 8085) with the built theme jar and the dev realm, in WSL podman.
# Containers: br-kc-test (Keycloak) and br-kc-smtp (mail sink on 2525). Passwords are generated here at run
# time into dev/.runtime/secrets.env (gitignored) and never printed. Stop everything with dev/kc-down.sh.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
KC_IMAGE="${KC_IMAGE:-quay.io/keycloak/keycloak:26.8.1}"
JAR="$(ls "$ROOT"/dist_keycloak/*.jar | head -n1)"
mkdir -p dev/.runtime
if [ ! -f dev/.runtime/secrets.env ]; then
  umask 077
  {
    echo "KC_ADMIN_PASSWORD=$(openssl rand -hex 16)"
    echo "KC_USER_PASSWORD=Br-$(openssl rand -hex 8)-aA1"
  } > dev/.runtime/secrets.env
fi
# shellcheck disable=SC1091
source dev/.runtime/secrets.env

podman rm -f br-kc-smtp br-kc-test >/dev/null 2>&1 || true   # only our own names

podman run -d --name br-kc-smtp --network host \
  -v "$ROOT/dev/smtp-sink.mjs:/sink/smtp-sink.mjs:ro" \
  docker.io/library/node:22-bookworm node /sink/smtp-sink.mjs 2525 >/dev/null

podman run -d --name br-kc-test --network host \
  -e KC_BOOTSTRAP_ADMIN_USERNAME=admin -e KC_BOOTSTRAP_ADMIN_PASSWORD="$KC_ADMIN_PASSWORD" \
  -v "$JAR:/opt/keycloak/providers/lotties-theme.jar:ro" \
  -v "$ROOT/dev/realm-babyroutine-dev.json:/opt/keycloak/data/import/realm-babyroutine-dev.json:ro" \
  "$KC_IMAGE" start-dev --http-port=8085 --import-realm >/dev/null

echo "waiting for Keycloak..."
for _ in $(seq 1 90); do
  if curl -fs http://localhost:8085/realms/babyroutine-dev/.well-known/openid-configuration >/dev/null 2>&1; then break; fi
  sleep 2
done
curl -fs http://localhost:8085/realms/babyroutine-dev/.well-known/openid-configuration >/dev/null

echo "Keycloak is up on http://localhost:8085 (realm babyroutine-dev). Admin password: see dev/.runtime/secrets.env"
echo "Run the flows: node dev/flows/run-flows.mjs (creates and deletes its own test users)."
