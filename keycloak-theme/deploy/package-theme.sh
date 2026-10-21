#!/usr/bin/env bash
# Builds the Keycloak theme and packages it in "directory mode" (no jar, no `kc.sh build`):
#   deploy/out/theme/baby-routine/login/...     plain directory (what Keycloak reads from /opt/.../themes/)
#   deploy/out/baby-routine-theme.tar.gz        same tree, top-level folder "baby-routine"
#   deploy/out/baby-routine-theme.tar.gz.sha256 checksum (hex digest + file name, `sha256sum -c` format)
#
# Usage (Linux, macOS, WSL; from anywhere):
#   bash keycloak-theme/deploy/package-theme.sh              # builds the jar with build-in-podman.sh, then packages
#   SKIP_BUILD=1 bash keycloak-theme/deploy/package-theme.sh # package the jar already in dist_keycloak/
#   CONTAINER_CLI=docker bash ...                            # use Docker instead of Podman
# Keycloakify only emits the jar (dist_keycloak/*.jar); the theme directory is the jar's theme/ folder.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
THEME_ROOT="$(cd "$HERE/.." && pwd)"
OUT="$HERE/out"
NAME=baby-routine

if [ "${SKIP_BUILD:-0}" != "1" ]; then
  bash "$THEME_ROOT/build-in-podman.sh"
fi

JAR="$(ls "$THEME_ROOT"/dist_keycloak/*all-other-versions*.jar 2>/dev/null | head -n1 || true)"
[ -n "$JAR" ] || JAR="$(ls "$THEME_ROOT"/dist_keycloak/*.jar 2>/dev/null | head -n1 || true)"
[ -n "$JAR" ] || { echo "No jar in $THEME_ROOT/dist_keycloak. Run without SKIP_BUILD=1." >&2; exit 1; }
echo "Using jar: $JAR"

rm -rf "$OUT"
mkdir -p "$OUT/theme"
if command -v unzip >/dev/null 2>&1; then
  unzip -q "$JAR" "theme/*" -d "$OUT/jar"
elif command -v bsdtar >/dev/null 2>&1; then
  mkdir -p "$OUT/jar" && bsdtar -xf "$JAR" -C "$OUT/jar" theme
else
  python3 -I - "$JAR" "$OUT/jar" <<'PY'
import sys, zipfile
z = zipfile.ZipFile(sys.argv[1])
z.extractall(sys.argv[2], [n for n in z.namelist() if n.startswith("theme/")])
PY
fi
mv "$OUT/jar/theme/$NAME" "$OUT/theme/$NAME"
rm -rf "$OUT/jar"

# Structure check: what Keycloak 26 needs from a directory theme.
T="$OUT/theme/$NAME/login"
[ -f "$T/theme.properties" ] || { echo "missing $T/theme.properties" >&2; exit 1; }
grep -q '^parent=keycloak' "$T/theme.properties" || { echo "theme.properties has no parent=keycloak" >&2; exit 1; }
[ -f "$T/login.ftl" ] && [ -d "$T/resources" ] && [ -d "$T/messages" ] || { echo "login.ftl, resources/ or messages/ missing" >&2; exit 1; }
# Directory mode must not depend on the jar descriptor, but it is harmless; nothing else to strip.

# Reproducible tarball with sane modes (the working tree may live on a filesystem without unix modes, e.g. /mnt/e).
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
cp -R "$OUT/theme/$NAME" "$STAGE/$NAME"
find "$STAGE" -type d -exec chmod 755 {} +
find "$STAGE" -type f -exec chmod 644 {} +
tar --sort=name --mtime='2000-01-01 00:00:00' --owner=0 --group=0 --numeric-owner     -C "$STAGE" -czf "$OUT/baby-routine-theme.tar.gz" "$NAME"
(cd "$OUT" && sha256sum baby-routine-theme.tar.gz > baby-routine-theme.tar.gz.sha256)

echo "Theme directory : $OUT/theme/$NAME  ($(find "$OUT/theme/$NAME" -type f | wc -l) files, $(du -sh "$OUT/theme/$NAME" | cut -f1))"
echo "Tarball         : $OUT/baby-routine-theme.tar.gz  ($(du -h "$OUT/baby-routine-theme.tar.gz" | cut -f1))"
echo "sha256          : $(cut -d' ' -f1 "$OUT/baby-routine-theme.tar.gz.sha256")"
