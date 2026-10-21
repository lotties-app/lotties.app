#!/usr/bin/env bash
# Points a realm's outgoing email (Realm settings > Email) at an SMTP relay such as Brevo, through the Keycloak
# admin REST API. Idempotent: prints what differs, writes only when something changed. Needs curl and jq.
#
#   KC_URL=https://auth.example.com KC_REALM=baby-routine KC_ADMIN_USER=admin KC_ADMIN_PASSWORD=... \
#   SMTP_HOST=smtp-relay.brevo.com SMTP_USER=... SMTP_PASSWORD=... SMTP_FROM=no-reply@example.com \
#     bash configure-realm-smtp.sh [--dry-run]
#
# Env (environment only; secrets are never printed and never put on a command line):
#   KC_URL KC_REALM KC_ADMIN_USER KC_ADMIN_PASSWORD   as in configure-realm.sh (KC_ADMIN_REALM, KC_INSECURE too)
#   SMTP_HOST       relay host, e.g. smtp-relay.brevo.com
#   SMTP_PORT       default 587 (STARTTLS)
#   SMTP_USER       SMTP login (for Brevo: the login shown under SMTP & API > SMTP, not your account email)
#   SMTP_PASSWORD   SMTP key/password (for Brevo: an SMTP key, not the account password)
#   SMTP_FROM       sender address; its domain must be verified (SPF + DKIM) at the provider
#   SMTP_FROM_NAME  default "Baby Routine"
#   SMTP_REPLY_TO   optional
#   SMTP_SECURITY   starttls (default) | ssl | none
#   REALM_VERIFY_EMAIL=1   also turn on "Verify email" for new users (leave unset to keep the current value)
# --dry-run: reads the realm and prints the intended changes, writes nothing.
# Keycloak masks the stored password on read, so a password change alone is detected only with --force.
set -euo pipefail

DRY=0
FORCE=0
for a in "$@"; do
  case "$a" in
    --dry-run) DRY=1 ;;
    --force) FORCE=1 ;;
    -h|--help) sed -n '2,21p' "$0"; exit 0 ;;
    *) echo "unknown argument: $a" >&2; exit 2 ;;
  esac
done
for v in KC_URL KC_REALM KC_ADMIN_USER KC_ADMIN_PASSWORD SMTP_HOST SMTP_USER SMTP_PASSWORD SMTP_FROM; do
  [ -n "${!v:-}" ] || { echo "$v is not set" >&2; exit 2; }
done
command -v curl >/dev/null && command -v jq >/dev/null || { echo "curl and jq are required" >&2; exit 2; }

URL="${KC_URL%/}"
ADMIN_REALM="${KC_ADMIN_REALM:-master}"
CURL=(curl -sS --max-time 30)
[ -z "${KC_INSECURE:-}" ] || CURL+=(-k)

TOKEN="$(printf '%s' "$KC_ADMIN_PASSWORD" | "${CURL[@]}" -f \
  --data-urlencode "client_id=admin-cli" --data-urlencode "grant_type=password" \
  --data-urlencode "username=$KC_ADMIN_USER" --data-urlencode "password@/dev/stdin" \
  "$URL/realms/$ADMIN_REALM/protocol/openid-connect/token" | jq -r '.access_token // empty')" \
  || { echo "Could not get an admin token from $URL (check KC_URL, user and password)." >&2; exit 1; }
[ -n "$TOKEN" ] || { echo "No access token in the response." >&2; exit 1; }
authh() { printf 'Authorization: Bearer %s\n' "$TOKEN"; }
api() {
  local m="$1" p="$2"
  "${CURL[@]}" -X "$m" -H @<(authh) -H 'Content-Type: application/json' "$URL/admin$p" "${@:3}"
}

REALM_JSON="$(api GET "/realms/$KC_REALM" -f)" || { echo "Could not read realm '$KC_REALM'." >&2; exit 1; }

case "${SMTP_SECURITY:-starttls}" in
  starttls) STARTTLS=true; SSL=false ;;
  ssl)      STARTTLS=false; SSL=true ;;
  none)     STARTTLS=false; SSL=false ;;
  *) echo "SMTP_SECURITY must be starttls, ssl or none" >&2; exit 2 ;;
esac
PORT="${SMTP_PORT:-587}"

# The password comes in through jq's environment access, not argv.
SMTP="$(SMTP_PASSWORD="$SMTP_PASSWORD" jq -nc \
  --arg host "$SMTP_HOST" --arg port "$PORT" --arg user "$SMTP_USER" --arg from "$SMTP_FROM" \
  --arg fromName "${SMTP_FROM_NAME:-Baby Routine}" --arg replyTo "${SMTP_REPLY_TO:-}" \
  --arg starttls "$STARTTLS" --arg ssl "$SSL" '
  {host: $host, port: $port, auth: "true", user: $user, password: env.SMTP_PASSWORD,
   from: $from, fromDisplayName: $fromName, starttls: $starttls, ssl: $ssl}
  + (if $replyTo == "" then {} else {replyTo: $replyTo} end)')"

# Compare everything except the password (Keycloak returns it masked).
# $SMTP holds the password: it reaches jq through the environment (never argv); the password is dropped before comparing.
CHANGES="$(SMTP_JSON="$SMTP" jq -r '
  (.smtpServer // {}) as $cur
  | ((env.SMTP_JSON | fromjson) | del(.password) | to_entries[])
  | select($cur[.key] != .value)
  | "  smtpServer.\(.key): \(if $cur[.key] == null then "(unset)" else ($cur[.key] | tojson) end) -> \(.value | tojson)"' <<<"$REALM_JSON")"
if [ -n "${REALM_VERIFY_EMAIL:-}" ] && [ "$(jq -r '.verifyEmail' <<<"$REALM_JSON")" != "true" ]; then
  CHANGES="${CHANGES:+$CHANGES$'\n'}  verifyEmail: false -> true"
fi

if [ -z "$CHANGES" ] && [ "$FORCE" = 0 ]; then
  echo "realm '$KC_REALM' email already configured. Nothing to do (use --force to re-send the password)."
  exit 0
fi
echo "realm '$KC_REALM' changes:"
[ -z "$CHANGES" ] || echo "$CHANGES"
[ "$FORCE" = 0 ] || echo "  smtpServer.password: (re-sent)"
if [ "$DRY" = 1 ]; then
  echo "(dry run: nothing written)"
  exit 0
fi

# The JSON holds the password: hand it to jq through the environment, not argv.
PATCH="$(SMTP_JSON="$SMTP" jq -c --arg verify "${REALM_VERIFY_EMAIL:-}"   '{smtpServer: (env.SMTP_JSON | fromjson)} + (if $verify == "" then {} else {verifyEmail: true} end)' <<<"null")"
code="$(printf '%s' "$PATCH" | api PUT "/realms/$KC_REALM" -o /dev/null -w '%{http_code}' -d @-)"
[ "$code" = 204 ] || { echo "Update failed (HTTP $code)." >&2; exit 1; }
echo "done. Test it: Realm settings > Email > Test connection (or register a user)."
