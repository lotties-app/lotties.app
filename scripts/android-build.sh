#!/usr/bin/env bash
# Runs Gradle for code/mobile/android in a local Podman container (image br-android-build, built from
# code/mobile/android/tools/Containerfile). For machines without the Android SDK; CI does not use it.
#   scripts/android-build.sh image                 build the image once
#   scripts/android-build.sh assembleDebug lintDebug testDebugUnitTest
#   LOTTIES_NODE_MODULES=/mnt/e/<main clone>/code/mobile/node_modules scripts/android-build.sh ...   (from a worktree)
# Run from WSL (the repository is bind-mounted). The Gradle cache lives in the volume br-android-gradle.
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [ "${1:-}" = "image" ]; then
  exec podman build --network host -t br-android-build -f "$root/code/mobile/android/tools/Containerfile" "$root/code/mobile/android/tools"
fi
# A worktree's node_modules are junctions to the main clone, which do not resolve inside the container: remove the
# worktree's code/mobile/node_modules junction (rmdir) and pass the main clone's folder; it is mounted copy-on-write
# (:O), so the Gradle build dirs inside node_modules/@capacitor never reach the main clone.
extra=()
if [ -n "${LOTTIES_NODE_MODULES:-}" ]; then
  extra=(-v "$LOTTIES_NODE_MODULES:/work/code/mobile/node_modules:O")
fi
# The wrapper jar instead of ./gradlew: a Windows checkout (core.autocrlf) gives gradlew CRLF line ends.
exec podman run --rm --network host -v "$root:/work" "${extra[@]}" -v br-android-gradle:/root/.gradle \
  -w /work/code/mobile/android br-android-build \
  java -cp gradle/wrapper/gradle-wrapper.jar org.gradle.wrapper.GradleWrapperMain --no-daemon "$@"
