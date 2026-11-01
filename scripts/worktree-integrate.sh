#!/usr/bin/env bash
# Integrates one finished feature branch into main, in the main clone (docs/PROCESS.md). Never pushes or deploys.
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/worktree-integrate.sh <name>

Integrates feat/<name> into main, one feature at a time, from any checkout:
  1. checks: the main clone has main checked out and no uncommitted tracked change (the owner's local .gitignore
     lines CLAUDE.md and .claude/ are allowed and kept); the feature worktree has nothing uncommitted;
  2. rebases feat/<name> onto main in its worktree; on a conflict the rebase is aborted (nothing changes) and each
     conflicting file is printed with its hot-spot rule: nothing is ever resolved automatically;
  3. when the branch adds an EF migration and main gained migrations since the branch started (or sorts after it),
     runs scripts/regen-migrations.sh in the worktree and commits the result on the branch; otherwise, when the
     branch adds migrations, runs the migration tests;
  4. merges feat/<name> into main with --no-ff in the main clone;
  5. prints the checklist: full checks, secrets scan, push, backup, migrations, deploy, verify, cleanup.
It never pushes, deploys or touches a database.
EOF
}

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=scripts/worktree-lib.sh
. "$SCRIPT_DIR/worktree-lib.sh"

NAME=''
while [ $# -gt 0 ]; do
  case "$1" in
    -h | --help) usage; exit 0 ;;
    -*) die "unknown option $1 (see --help)" ;;
    *) [ -z "$NAME" ] || die "one name only (see --help)"; NAME=$1; shift ;;
  esac
done
[ -n "$NAME" ] || { usage >&2; exit 2; }
[[ "$NAME" =~ ^[a-z0-9][a-z0-9-]{0,39}$ ]] || die "invalid name '$NAME'"

TARGET=main
BRANCH="feat/$NAME"
MAIN=$(main_root "$SCRIPT_DIR")
WT=$(worktree_of_branch "$MAIN" "$BRANCH") || die "no worktree has $BRANCH checked out (scripts/worktree-new.sh $NAME)"

# ── 1. Preconditions ────────────────────────────────────────────────────────
[ "$(git -C "$MAIN" symbolic-ref --quiet --short HEAD || true)" = "$TARGET" ] || die "the main clone ($MAIN) must have $TARGET checked out"
changes=$(tracked_changes "$MAIN")
[ -z "$changes" ] || die "the main clone has uncommitted changes; commit or stash them first:"$'\n'"$changes"
OWNER_LINES=$(owner_gitignore_additions "$MAIN") || die "unexpected uncommitted change in $MAIN/.gitignore"
pending=$(git -C "$WT" status --porcelain)
[ -z "$pending" ] || die "$WT has uncommitted or untracked files; commit them on $BRANCH (or delete them) first:"$'\n'"$pending"
[ "$(git -C "$MAIN" rev-list --count "$TARGET..$BRANCH")" -gt 0 ] || die "$BRANCH has no commit that $TARGET lacks: nothing to integrate"

BEFORE=$(git -C "$MAIN" rev-parse "$TARGET")
FORK=$(git -C "$MAIN" merge-base "$TARGET" "$BRANCH")
mapfile -t main_migrations < <(added_migrations "$MAIN" "$FORK" "$TARGET")
mapfile -t branch_migrations < <(added_migrations "$MAIN" "$FORK" "$BRANCH")

# ── 2. Rebase in the worktree (abort on any conflict) ───────────────────────
info "rebasing $BRANCH onto $TARGET in $WT"
if ! git -C "$WT" -c core.autocrlf=false rebase --quiet "$TARGET"; then
  mapfile -t conflicts < <(git -C "$WT" diff --name-only --diff-filter=U)
  git -C "$WT" rebase --abort
  {
    echo ""
    echo "The rebase of $BRANCH onto $TARGET conflicts; it was aborted (nothing changed). Conflicting files:"
    for file in "${conflicts[@]}"; do
      printf '  %s\n      rule: %s\n' "$file" "$(hotspot_rule "$file")"
    done
    echo ""
    echo "Resolve in the worktree: cd $WT && git rebase $TARGET, fix each file by its rule, git add, git rebase --continue;"
    echo "run the checks there, then run this script again."
  } >&2
  exit 1
fi

# ── 3. Migrations ───────────────────────────────────────────────────────────
if [ "${#branch_migrations[@]}" -gt 0 ]; then
  latest_main=$(latest_migration_at "$MAIN" "$TARGET")
  reordered=0
  for id in "${branch_migrations[@]}"; do
    if [[ "$id" < "$latest_main" ]]; then reordered=1; fi
  done
  if [ "${#main_migrations[@]}" -gt 0 ] || [ "$reordered" = 1 ]; then
    [ "${#branch_migrations[@]}" = 1 ] || die "$BRANCH adds ${#branch_migrations[@]} migrations (${branch_migrations[*]}) and $TARGET gained migrations: squash them into one migration in the worktree, then run this again (nothing merged)"
    migration=${branch_migrations[0]#*_}
    info "$TARGET gained migrations since $BRANCH started (${main_migrations[*]:-reordered}): regenerating $migration"
    if ! "$SCRIPT_DIR/regen-migrations.sh" --base "$TARGET" --checkout "$WT" "$migration"; then
      die "regen-migrations.sh stopped (see above). Nothing merged: review $WT, commit on $BRANCH, then run this again"
    fi
    git -C "$WT" add -A -- "$MIGRATIONS_DIR"
    git -C "$WT" add -u
    git -C "$WT" commit --quiet -m "chore(api): regenerate migration $migration on top of $TARGET's migrations"
    info "committed the regenerated migration on $BRANCH"
  else
    info "running the migration tests in $WT"
    dotnet test "$WT/code/api/tests/Lotties.Infrastructure.Tests" --nologo --verbosity quiet \
      --filter "FullyQualifiedName~Persistence.MigrationTests" || die "the migration tests failed in $WT: nothing merged"
  fi
fi

# ── 4. Merge in the main clone (the owner's .gitignore lines are kept) ──────
restore_owner_lines() {
  local line
  [ -n "$OWNER_LINES" ] || return 0
  [ -z "$(tail -c 1 "$MAIN/.gitignore")" ] || printf '\n' >> "$MAIN/.gitignore"
  while IFS= read -r line; do
    grep -qxF -- "$line" "$MAIN/.gitignore" || printf '%s\n' "$line" >> "$MAIN/.gitignore"
  done <<< "$OWNER_LINES"
}
if [ -n "$OWNER_LINES" ]; then
  trap restore_owner_lines EXIT
  git -C "$MAIN" checkout -- .gitignore
fi
if ! git -C "$MAIN" merge --no-ff --no-edit -m "Merge branch '$BRANCH'" "$BRANCH"; then
  git -C "$MAIN" merge --abort || true
  die "the merge into $TARGET failed and was aborted (nothing merged)"
fi
AFTER=$(git -C "$MAIN" rev-parse --short "$TARGET")
mapfile -t merged_migrations < <(added_migrations "$MAIN" "$BEFORE" "$TARGET")

# ── 5. Checklist ────────────────────────────────────────────────────────────
cat <<EOF

Merged $BRANCH into $TARGET ($AFTER) in $MAIN. Nothing was pushed or deployed.
Migrations added by this merge: ${merged_migrations[*]:-none}

Checklist (in the main clone, one feature at a time; docs/PROCESS.md "Integrate and deploy"):
  1. Full checks:
       npm --prefix code/web run lint
       (cd code/web && npx prettier --check .)
       npm --prefix code/web run test -- --run
       npm --prefix code/web run build
       dotnet build code/api/Lotties.sln && dotnet test code/api/Lotties.sln
  2. Secrets scan of what the merge brings (review every hit; .env files are never committed):
       git diff $BEFORE $TARGET | grep -nIiE '(password|secret|token|api[_-]?key|private[_-]?key|BEGIN [A-Z ]*PRIVATE)'
  3. Push:      git push origin $TARGET
  4. Backup:    take a database backup before a deploy that applies migrations
  5. Migrations (if any above): docs/DEPLOY.md "Applying migrations", before the API that needs them
  6. Deploy, from the main clone in WSL (never from a worktree):
       DRY_RUN=1 ./deploy/homelab/deploy.sh   then   ./deploy/homelab/deploy.sh
  7. Verify:    deploy/homelab/README.md "Verify"; roll back with "Roll back" there if needed
  8. Clean up:  scripts/worktree-remove.sh $NAME --delete-branch
EOF
