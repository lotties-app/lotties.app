# shellcheck shell=bash
# Helpers shared by the worktree scripts (docs/PROCESS.md). Sourced, never run on its own.
# Git Bash on Windows: junctions are made and removed through Windows PowerShell.

# Packages whose node_modules a worktree links (junction) to the main clone's, when the main clone has one.
NODE_PACKAGES=(code/web code/mobile tests/e2e code/keycloak-theme)

# EF Core migrations (repository-relative) and the test that pins the deployed ones.
MIGRATIONS_DIR=code/api/src/Lotties.Infrastructure/Persistence/Migrations
MIGRATION_TESTS=code/api/tests/Lotties.Infrastructure.Tests/Persistence/MigrationTests.cs
SNAPSHOT_FILE=$MIGRATIONS_DIR/LottiesDbContextModelSnapshot.cs

# The lines the owner adds to .gitignore in the main clone, never committed.
OWNER_IGNORE_LINES=('CLAUDE.md' '.claude/')

die() { printf 'error: %s\n' "$*" >&2; exit 1; }
warn() { printf 'warning: %s\n' "$*" >&2; }
info() { printf '%s\n' "$*"; }

# Absolute path (E:/...) of the main clone: the checkout that owns the .git directory, whichever checkout runs this.
main_root() { # any path inside a checkout
  local common
  common=$(git -C "$1" rev-parse --path-format=absolute --git-common-dir) || die "$1 is not inside a git checkout"
  dirname "$common"
}

# Lower-case, forward-slash, no trailing slash form of a path, to compare paths that git and bash print differently.
norm_path() {
  local p
  p=$(cygpath -m "$1")
  p=${p%/}
  printf '%s' "${p,,}"
}

# Prints the path of every registered worktree, the main one first.
worktree_paths() { # main clone
  git -C "$1" worktree list --porcelain | sed -n 's/^worktree //p'
}

# Prints the path of the worktree that has branch $2 checked out; fails when there is none.
worktree_of_branch() { # main clone, branch
  git -C "$1" worktree list --porcelain | awk -v ref="refs/heads/$2" '
    /^worktree / { path = substr($0, 10) }
    $0 == "branch " ref { print path; found = 1 }
    END { exit found ? 0 : 1 }'
}

# 0 when $2 is a registered worktree of the main clone $1 other than the main clone itself.
is_secondary_worktree() { # main clone, path
  local wanted first=1 path
  wanted=$(norm_path "$2")
  while IFS= read -r path; do
    if [ "$first" = 1 ]; then first=0; continue; fi
    [ "$(norm_path "$path")" = "$wanted" ] && return 0
  done < <(worktree_paths "$1")
  return 1
}

# 0 when the worktree at $2 is locked (an agent or a tool holds it).
is_locked_worktree() { # main clone, path
  local wanted path
  wanted=$(norm_path "$2")
  while IFS= read -r path; do
    [ "$(norm_path "$path")" = "$wanted" ] && return 0
  done < <(git -C "$1" worktree list --porcelain | awk '/^worktree / { path = substr($0, 10) } /^locked/ { print path }')
  return 1
}

# Single-quoted PowerShell string literal of $1.
ps_quote() { local s=${1//\'/\'\'}; printf "'%s'" "$s"; }

# Runs one Windows PowerShell command (no profile, no prompts); prints its output without carriage returns.
run_ps() {
  powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "$1" | tr -d '\r'
}

# 0 when $1 is a reparse point (a junction or a directory symbolic link).
is_reparse_point() { # path
  local out
  out=$(run_ps "\$i = Get-Item -LiteralPath $(ps_quote "$(cygpath -w "$1")") -Force -ErrorAction SilentlyContinue; if (\$i -and (\$i.Attributes -band [IO.FileAttributes]::ReparsePoint)) { 'yes' } else { 'no' }")
  [ "$out" = yes ]
}

# Creates the junction $1 pointing at the directory $2.
make_junction() { # link, target
  run_ps "New-Item -ItemType Junction -Path $(ps_quote "$(cygpath -w "$1")") -Target $(ps_quote "$(cygpath -w "$2")") | Out-Null"
  is_reparse_point "$1" || die "could not create the junction $1"
}

# Removes the link $1 itself (never what it points at): only after checking it is a reparse point.
remove_link() { # link
  is_reparse_point "$1" || die "$1 is not a junction or link: refusing to delete it"
  run_ps "[System.IO.Directory]::Delete($(ps_quote "$(cygpath -w "$1")"), \$false)"
  [ ! -e "$1" ] || die "could not remove the link $1"
}

# Prints the reparse points left under $1 (three levels deep), one per line.
reparse_points_under() { # directory
  run_ps "Get-ChildItem -LiteralPath $(ps_quote "$(cygpath -w "$1")") -Recurse -Depth 3 -Force -Attributes ReparsePoint -ErrorAction SilentlyContinue | ForEach-Object { \$_.FullName }"
}

# Prints the owner's lines added to .gitignore in checkout $1 (nothing when .gitignore is unchanged). Fails when
# .gitignore has any other uncommitted change.
owner_gitignore_additions() { # checkout
  local line content known owner
  while IFS= read -r line; do
    line=${line%$'\r'}
    case "$line" in
      'diff --git'* | 'index '* | '--- '* | '+++ '* | '@@'* | '\ No newline'*) continue ;;
      -*) return 1 ;;
      +*)
        content=${line#+}
        [ -z "${content//[[:space:]]/}" ] && continue
        known=0
        for owner in "${OWNER_IGNORE_LINES[@]}"; do [ "$content" = "$owner" ] && known=1; done
        [ "$known" = 1 ] || return 1
        printf '%s\n' "$content"
        ;;
    esac
  done < <(git -C "$1" -c core.autocrlf=false diff -U0 --no-color HEAD -- .gitignore)
}

# Prints the tracked files with uncommitted changes in checkout $1, leaving out .gitignore when its only change is
# the owner's local lines.
tracked_changes() { # checkout
  local changes
  changes=$(git -C "$1" status --porcelain --untracked-files=no)
  if [ -n "$(owner_gitignore_additions "$1" 2>/dev/null)" ]; then
    changes=$(printf '%s\n' "$changes" | grep -v '^.. \.gitignore$' || true)
  fi
  printf '%s' "$changes"
}

# Migration ids (20261022230039_Vaccines) whose Designer file was added between two commits.
added_migrations() { # checkout, from, to
  git -C "$1" diff --name-only --diff-filter=A "$2" "$3" -- "$MIGRATIONS_DIR/*.Designer.cs" |
    sed -e 's#.*/##' -e 's#\.Designer\.cs$##'
}

# Latest migration id at a commit (empty when there is none).
latest_migration_at() { # checkout, commit
  git -C "$1" ls-tree --name-only "$2" -- "$MIGRATIONS_DIR/" | sed -n 's#.*/\([0-9]\{14\}_[A-Za-z0-9]*\)\.Designer\.cs$#\1#p' | sort | tail -n 1
}

# How a conflict on $1 is resolved (docs/PROCESS.md, "Hot spots").
hotspot_rule() { # repository-relative path
  case "$1" in
    "$SNAPSHOT_FILE" | "$MIGRATIONS_DIR"/*)
      echo "EF migrations: keep main's side of the snapshot (during a rebase that is --ours), finish the rebase, then run scripts/regen-migrations.sh <YourMigration> in the worktree and commit" ;;
    "$MIGRATION_TESTS")
      echo "MigrationTests pinned list: take main's side (the list only changes when a migration is deployed); never add your migration to it" ;;
    code/web/src/i18n/locales/*/*.json)
      echo "i18n catalogs: two features edited the same feature file; keep both sides' keys (valid JSON, same keys in en and pt-BR), then run the catalogs test" ;;
    code/web/src/i18n/catalogEn.ts)
      echo "i18n typed list: keep both lines, sorted" ;;
    code/web/src/db/database.ts)
      echo "Dexie versions: keep main's entries as they are and renumber yours to the next free version (database.test.ts checks 1..n)" ;;
    */EndpointRoleMatrixTests.cs)
      echo "endpoint-role matrix: keep both sides' rows (each feature has its own commented block)" ;;
    docs/* | *.md)
      echo "docs (SPEC, PLAN, filemap, ...): keep both sides, main's text first" ;;
    *)
      echo "no known hot-spot rule: resolve by hand in the worktree" ;;
  esac
}
