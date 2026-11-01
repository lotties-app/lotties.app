#!/usr/bin/env bash
# Runs Gradle for code/mobile/android in a local Podman container (image br-android-build, built from
# code/mobile/android/tools/Containerfile). For machines without the Android SDK; CI does not use it.
#   scripts/android-build.sh image                 build the image once
#   scripts/android-build.sh assembleDebug lintDebug testDebugUnitTest
# Run from WSL (the repository is bind-mounted). The Gradle cache lives in the volume br-android-gradle.
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [ "${1:-}" = "image" ]; then
  exec podman build --network host -t br-android-build -f "$root/code/mobile/android/tools/Containerfile" "$root/code/mobile/android/tools"
fi
exec podman run --rm --network host -v "$root:/work" -v br-android-gradle:/root/.gradle \
  -w /work/code/mobile/android br-android-build ./gradlew --no-daemon "$@"
