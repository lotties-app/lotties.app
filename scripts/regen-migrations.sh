#!/usr/bin/env bash
# Re-creates one EF Core migration on top of the base branch's migrations (docs/PROCESS.md). Git Bash on Windows.
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/regen-migrations.sh <MigrationName> [--base <branch>] [--checkout <path>] [--no-test]

ONLY FOR A MIGRATION THAT WAS NEVER APPLIED TO ANY DATABASE (not deployed). Use it in a feature branch that is
rebased on <branch> (default main) when <branch> gained migrations the branch's migration was not generated on:
  1. deletes <timestamp>_<MigrationName>.cs and .Designer.cs and restores the model snapshot from <branch>;
  2. dotnet ef migrations add <MigrationName> (local tool, dummy DB_* values: no database is ever contacted), so
     the migration gets a new timestamp after <branch>'s latest and the Designer and snapshot hold the whole model;
  3. puts the old migration body (Up/Down, hand edits, comments) back and shows how it differs from what EF
     generated now (exit 3 when the code differs: review it);
  4. replaces the old migration id in other tracked files (docs, tests) with the new one;
  5. runs the migration tests (MigrationTests: deployed list, ids, Designers, snapshot), unless --no-test.
Nothing is committed. Refuses a deployed migration (pinned in MigrationTests.cs), a migration that exists on
<branch>, a checkout that is not rebased on <branch>, and uncommitted changes under the migrations folder.

--checkout <path>  the checkout to work in (default: the one containing the current directory)
EOF
}

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=scripts/worktree-lib.sh
. "$SCRIPT_DIR/worktree-lib.sh"

NAME=''
BASE=main
CHECKOUT=''
TEST=1
while [ $# -gt 0 ]; do
  case "$1" in
    -h | --help) usage; exit 0 ;;
    --base) [ $# -ge 2 ] || die "--base needs a branch"; BASE=$2; shift 2 ;;
    --checkout) [ $# -ge 2 ] || die "--checkout needs a path"; CHECKOUT=$2; shift 2 ;;
    --no-test) TEST=0; shift ;;
    -*) die "unknown option $1 (see --help)" ;;
    *) [ -z "$NAME" ] || die "one migration name only (see --help)"; NAME=$1; shift ;;
  esac
done
[ -n "$NAME" ] || { usage >&2; exit 2; }
[[ "$NAME" =~ ^[A-Z][A-Za-z0-9]*$ ]] || die "invalid migration name '$NAME' (PascalCase, as given to migrations add)"
CHECKOUT=$(git -C "${CHECKOUT:-$PWD}" rev-parse --show-toplevel) || die "not inside a git checkout"

cat >&2 <<'EOF'
************************************************************************************************
*  regen-migrations: only for a migration that was NEVER applied to any database.             *
*  A deployed migration must never be regenerated: add a new migration instead.                *
************************************************************************************************
EOF

# ── Find the migration and check it may be regenerated ──────────────────────
mapfile -t found < <(git -C "$CHECKOUT" ls-files -- "$MIGRATIONS_DIR/*_$NAME.Designer.cs")
[ "${#found[@]}" = 1 ] || die "expected one tracked migration named $NAME under $MIGRATIONS_DIR, found ${#found[@]}"
OLD_ID=$(basename "${found[0]}" .Designer.cs)
[[ "$OLD_ID" =~ ^[0-9]{14}_${NAME}$ ]] || die "unexpected migration file ${found[0]}"
OLD_CS="$MIGRATIONS_DIR/$OLD_ID.cs"
OLD_DESIGNER="$MIGRATIONS_DIR/$OLD_ID.Designer.cs"

if grep -qF "\"$OLD_ID\"" "$CHECKOUT/$MIGRATION_TESTS"; then
  die "$OLD_ID is a deployed migration (pinned in $MIGRATION_TESTS): never regenerate it"
fi
git -C "$CHECKOUT" rev-parse --verify --quiet "$BASE^{commit}" >/dev/null || die "no branch $BASE"
if git -C "$CHECKOUT" cat-file -e "$BASE:$OLD_CS" 2>/dev/null; then
  die "$OLD_ID already exists on $BASE: it is not this branch's migration"
fi
git -C "$CHECKOUT" merge-base --is-ancestor "$BASE" HEAD || die "the checkout is not rebased on $BASE: git rebase $BASE first"
[ -z "$(git -C "$CHECKOUT" status --porcelain -- "$MIGRATIONS_DIR")" ] || die "uncommitted changes under $MIGRATIONS_DIR: commit or discard them first"
command -v dotnet >/dev/null 2>&1 || die "dotnet not found"

# ── 1. Remove it, take the base's snapshot ──────────────────────────────────
SAVED=$(mktemp -d)
trap 'rm -rf "$SAVED"' EXIT
cp "$CHECKOUT/$OLD_CS" "$SAVED/old.cs"
rm -- "$CHECKOUT/$OLD_CS" "$CHECKOUT/$OLD_DESIGNER"
git -C "$CHECKOUT" show "$BASE:$SNAPSHOT_FILE" > "$CHECKOUT/$SNAPSHOT_FILE"
info "removed $OLD_ID; snapshot taken from $BASE"

# ── 2. Add it again (never touches a database) ──────────────────────────────
(
  cd "$CHECKOUT/code/api"
  dotnet tool restore >/dev/null
  # Dummy settings: migrations add only builds the model; the bogus host guarantees no real database is reached.
  env -u DB_PORT -u DB_MIGRATOR_USER -u DB_MIGRATOR_PASSWORD \
    DB_HOST=x DB_NAME=x DB_APP_USER=x DB_APP_PASSWORD=x \
    dotnet ef migrations add "$NAME" --project src/Lotties.Infrastructure --output-dir Persistence/Migrations
) || die "dotnet ef migrations add failed: restore the files with git -C $CHECKOUT checkout -- $MIGRATIONS_DIR"

mapfile -t added < <(cd "$CHECKOUT" && ls -- "$MIGRATIONS_DIR"/*_"$NAME".Designer.cs)
[ "${#added[@]}" = 1 ] || die "expected one new migration named $NAME, found ${#added[@]}"
NEW_ID=$(basename "${added[0]}" .Designer.cs)
NEW_CS="$MIGRATIONS_DIR/$NEW_ID.cs"
LATEST=$(cd "$CHECKOUT" && ls -- "$MIGRATIONS_DIR" | sed -n 's/^\([0-9]\{14\}_[A-Za-z0-9]*\)\.Designer\.cs$/\1/p' | sort | tail -n 1)
[ "$LATEST" = "$NEW_ID" ] || die "$NEW_ID is not the latest migration ($LATEST is)"

# ── 3. Keep the old body; show what EF generates now ────────────────────────
# Code only: no BOM, no carriage returns, no comment or blank lines.
code_of() { sed -e '1s/^\xEF\xBB\xBF//' -e 's/\r$//' "$1" | grep -vE '^[[:space:]]*(//|$)' || true; }
cp "$CHECKOUT/$NEW_CS" "$SAVED/generated.cs"
cp "$SAVED/old.cs" "$CHECKOUT/$NEW_CS"
STATUS=0
if ! diff -u <(code_of "$SAVED/generated.cs") <(code_of "$SAVED/old.cs") > "$SAVED/body.diff"; then
  STATUS=3
  warn "the migration body EF generates now differs from the old one (kept). Review it (- generated now, + kept):"
  cat "$SAVED/body.diff" >&2
fi

# ── 4. The new id in docs and tests ─────────────────────────────────────────
mapfile -t mentions < <(git -C "$CHECKOUT" grep -lF "$OLD_ID" -- . ":(exclude)$MIGRATIONS_DIR" || true)
for file in "${mentions[@]}"; do
  sed -i "s/$OLD_ID/$NEW_ID/g" "$CHECKOUT/$file"
  info "updated the migration id in $file"
done

# ── 5. Migration tests ──────────────────────────────────────────────────────
if [ "$TEST" = 1 ]; then
  dotnet test "$CHECKOUT/code/api/tests/Lotties.Infrastructure.Tests" --nologo --verbosity quiet \
    --filter "FullyQualifiedName~Persistence.MigrationTests" || die "the migration tests failed: review $CHECKOUT"
fi

info ""
info "Regenerated $OLD_ID as $NEW_ID in $CHECKOUT. Review (git -C $CHECKOUT status / diff), then commit."
exit "$STATUS"
