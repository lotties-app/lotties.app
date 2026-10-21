#!/usr/bin/env bash
# Builds deploy/out/themes/ = every theme folder that goes into the shared themes volume:
#   lotties/                      (from package-theme.sh)
#   example-other-app/                 (placeholder skin child theme, themes-extra/example-other-app/skin.css)
# Add a theme: put its folder in deploy/themes-extra/<name>/ (a ready theme dir containing login/) or a skin.css
# (then it is generated as a child of lotties), bump the image tag, build, helm upgrade.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
[ -d "$HERE/out/theme/lotties" ] || SKIP_BUILD="${SKIP_BUILD:-0}" bash "$HERE/package-theme.sh"
OUT="$HERE/out/themes"; rm -rf "$OUT"; mkdir -p "$OUT"
cp -R "$HERE/out/theme/lotties" "$OUT/lotties"
for d in "$HERE"/themes-extra/*/; do
  n="$(basename "$d")"
  if [ -f "$d/skin.css" ]; then bash "$HERE/make-child-theme.sh" "$n" "$d/skin.css" "$OUT"
  elif [ -d "$d/login" ]; then cp -R "$d" "$OUT/$n"; echo "theme $n copied"; fi
done
find "$OUT" -type d -exec chmod 755 {} +; find "$OUT" -type f -exec chmod 644 {} +
ls "$OUT"
