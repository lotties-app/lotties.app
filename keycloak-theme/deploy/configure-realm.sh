#!/usr/bin/env bash
# Sets a realm's login theme to baby-routine and enables internationalization with en + pt-BR, through the
# Keycloak admin REST API. Idempotent: only changes what differs, prints what it did. Needs curl and jq.
#
#   KC_URL=https://auth.example.com KC_REALM=baby-routine KC_ADMIN_USER=admin KC_ADMIN_PASSWORD=... \
#     bash configure-realm.sh [--dry-run]
#
# Env (read from the environment only, the password is never printed and not put on a command line):
#   KC_URL             base URL of Keycloak, no trailing slash, no /auth (Keycloak 17+ has none)
#   KC_REALM           realm to configure
#   KC_ADMIN_USER      admin user of the `master` realm (or KC_ADMIN_REALM to authenticate in another realm)
#   KC_ADMIN_PASSWORD  its password
#   KC_THEME           theme name (default baby-routine)
#   KC_DEFAULT_LOCALE  only used when the realm has no default locale yet (default en)
# --dry-run: reads the realm and prints the intended changes, writes nothing.
# Existing supported locales are kept; en and pt-BR are added when missing. An existing default locale is kept.
set -euo pipefail

DRY=0
for a in "$@"; do
  case "$a" in
    --dry-run) DRY=1 ;;
    -h|--help) sed -n '2,17p' "$0"; exit 0 ;;
    *) echo "unknown argument: $a" >&2; exit 2 ;;
  esac
done
for v in KC_URL KC_REALM KC_ADMIN_USER KC_ADMIN_PASSWORD; do
  [ -n "${!v:-}" ] || { echo "$v is not set" >&2; exit 2; }
done
command -v curl >/dev/null && command -v jq >/dev/null || { echo "curl and jq are required" >&2; exit 2; }

URL="${KC_URL%/}"
THEME="${KC_THEME:-baby-routine}"
DEFLOC="${KC_DEFAULT_LOCALE:-en}"
ADMIN_REALM="${KC_ADMIN_REALM:-master}"
CURL=(curl -sS --max-time 30)
[ -z "${KC_INSECURE:-}" ] || CURL+=(-k)

# Token: the password goes through stdin (curl reads the form field from /dev/stdin), never argv.
TOKEN="$(printf '%s' "$KC_ADMIN_PASSWORD" | "${CURL[@]}" -f \
  --data-urlencode "client_id=admin-cli" --data-urlencode "grant_type=password" \
  --data-urlencode "username=$KC_ADMIN_USER" --data-urlencode "password@/dev/stdin" \
  "$URL/realms/$ADMIN_REALM/protocol/openid-connect/token" | jq -r '.access_token // empty')" \
  || { echo "Could not get an admin token from $URL (check KC_URL, user and password)." >&2; exit 1; }
[ -n "$TOKEN" ] || { echo "No access token in the response." >&2; exit 1; }
authh() { printf 'Authorization: Bearer %s\n' "$TOKEN"; }
api() { # api METHOD PATH [json-body-from-stdin]
  local m="$1" p="$2"
  "${CURL[@]}" -X "$m" -H @<(authh) -H 'Content-Type: application/json' "$URL/admin$p" "${@:3}"
}

REALM_JSON="$(api GET "/realms/$KC_REALM" -f)" || { echo "Could not read realm '$KC_REALM'." >&2; exit 1; }

# Is the theme installed? (serverinfo lists the themes Keycloak found)
if api GET "/serverinfo" -f 2>/dev/null | jq -e --arg t "$THEME" '(.themes.login // []) | map(.name) | index($t) != null' >/dev/null; then
  echo "theme '$THEME' is installed in Keycloak (login)."
else
  echo "WARNING: theme '$THEME' is NOT in Keycloak's login theme list (or serverinfo is not readable)." >&2
  echo "         Install it first (see docs/DEPLOY.md); the realm would show Keycloak's default theme." >&2
  [ "$DRY" = 1 ] || { echo "Aborting. Use --dry-run to only see the changes." >&2; exit 1; }
fi

PATCH="$(jq -c --arg theme "$THEME" --arg defloc "$DEFLOC" '
  ((.supportedLocales // []) + ["en","pt-BR"] | unique) as $loc
  | {
      loginTheme: $theme,
      internationalizationEnabled: true,
      supportedLocales: $loc,
      defaultLocale: (if (.defaultLocale // "") == "" then $defloc else .defaultLocale end)
    }
' <<<"$REALM_JSON")"

CHANGES="$(jq -r --argjson want "$PATCH" '
  . as $cur
  | $want | to_entries[]
  | select(($cur[.key] | (if type=="array" then sort else . end)) != (.value | (if type=="array" then sort else . end)))
  | "  \(.key): \(if $cur[.key] == null then "(unset)" else ($cur[.key] | tojson) end) -> \(.value | tojson)"' <<<"$REALM_JSON")"

if [ -z "$CHANGES" ]; then
  echo "realm '$KC_REALM' already configured. Nothing to do."
  exit 0
fi
echo "realm '$KC_REALM' changes:"
echo "$CHANGES"
if [ "$DRY" = 1 ]; then
  echo "(dry run: nothing written)"
  exit 0
fi
code="$(printf '%s' "$PATCH" | api PUT "/realms/$KC_REALM" -o /dev/null -w '%{http_code}' -d @-)"
[ "$code" = 204 ] || { echo "Update failed (HTTP $code)." >&2; exit 1; }
echo "done."
