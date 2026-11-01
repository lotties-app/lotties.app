#!/usr/bin/env bash
# Makes a "skin" child theme of lotties WITHOUT rebuilding anything:
#   bash make-child-theme.sh <name> <skin.css> [outdir]      (default outdir: deploy/out/themes)
# Result: <outdir>/<name>/login/{theme.properties (parent=lotties), *.ftl, resources/css/skin.css}
# Keycloakify's pages do not read the `styles=` theme property, so each parent .ftl is copied with one extra
# <link> to resources/css/skin.css. Everything else (JS, fonts, images, messages) is inherited from the parent
# through Keycloak's theme parent chain. Needs deploy/out/theme/lotties (package-theme.sh).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
NAME="${1:?theme name}"; SKIN="${2:?skin css file}"; OUT="${3:-$HERE/out/themes}"
PARENT="$HERE/out/theme/lotties/login"
[ -d "$PARENT" ] || { echo "Run package-theme.sh first." >&2; exit 1; }
D="$OUT/$NAME/login"
rm -rf "$OUT/$NAME"; mkdir -p "$D/resources/css"
printf 'parent=lotties\n' > "$D/theme.properties"
cp "$SKIN" "$D/resources/css/skin.css"
for f in "$PARENT"/*.ftl; do
  sed 's#</head>#<link rel="stylesheet" href="${xKeycloakify.resourcesPath}/css/skin.css"></head>#' "$f" > "$D/$(basename "$f")"
done
echo "child theme $NAME -> $D ($(ls "$D"/*.ftl | wc -l) pages)"
