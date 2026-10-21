#!/usr/bin/env bash
# Stops and removes only the containers this theme's test run created.
podman rm -f br-kc-test br-kc-smtp >/dev/null 2>&1 || true
echo "removed br-kc-test and br-kc-smtp (if present)"
