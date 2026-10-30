#!/usr/bin/env bash
# Creates the git worktree of one feature (docs/PROCESS.md). Git Bash on Windows.
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/worktree-new.sh <name> [--base <branch>] [--no-restore]

Creates a worktree for one feature, from any checkout of the repository:
  - branch feat/<name> from the latest <branch> (default main; fetched first; origin/<branch> when the local
    branch is behind it), checked out with LF line endings like the main clone;
  - at $WORKTREE_ROOT/<name> (default E:/w/<name>: a short root, Windows paths are limited to 260 characters);
  - node_modules of code/web, code/mobile and tests/e2e linked (junctions) to the main
    clone's, for each package that has one there: never run npm install or npm ci in the worktree;
  - dotnet restore of code/api/Lotties.sln (skip with --no-restore).
Refuses a name whose branch, folder or worktree already exists. Changes nothing in the main clone's files.

<name>: lower-case letters, digits and dashes (e.g. growth-charts).
EOF
}

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=scripts/worktree-lib.sh
. "$SCRIPT_DIR/worktree-lib.sh"

NAME=''
BASE=main
RESTORE=1
while [ $# -gt 0 ]; do
  case "$1" in
    -h | --help) usage; exit 0 ;;
    --base) [ $# -ge 2 ] || die "--base needs a branch"; BASE=$2; shift 2 ;;
    --no-restore) RESTORE=0; shift ;;
    -*) die "unknown option $1 (see --help)" ;;
    *) [ -z "$NAME" ] || die "one name only (see --help)"; NAME=$1; shift ;;
  esac
done
[ -n "$NAME" ] || { usage >&2; exit 2; }
[[ "$NAME" =~ ^[a-z0-9][a-z0-9-]{0,39}$ ]] || die "invalid name '$NAME': lower-case letters, digits and dashes, at most 40"

MAIN=$(main_root "$SCRIPT_DIR")
ROOT=${WORKTREE_ROOT:-E:/w}
WT="$ROOT/$NAME"
BRANCH="feat/$NAME"

# ── Refuse anything that already exists ─────────────────────────────────────
if git -C "$MAIN" show-ref --verify --quiet "refs/heads/$BRANCH"; then die "branch $BRANCH already exists"; fi
[ ! -e "$WT" ] || die "$WT already exists"
while IFS= read -r path; do
  [ "$(norm_path "$path")" != "$(norm_path "$WT")" ] || die "a worktree is already registered at $WT (git worktree prune?)"
done < <(worktree_paths "$MAIN")
git -C "$MAIN" show-ref --verify --quiet "refs/heads/$BASE" || die "no local branch $BASE in $MAIN"

changes=$(tracked_changes "$MAIN")
[ -z "$changes" ] || warn "the main clone has uncommitted changes (not part of the new branch):"$'\n'"$changes"

# ── The latest base ─────────────────────────────────────────────────────────
START=$BASE
if git -C "$MAIN" remote get-url origin >/dev/null 2>&1; then
  if git -C "$MAIN" fetch --quiet origin "$BASE" 2>/dev/null; then
    if git -C "$MAIN" show-ref --verify --quiet "refs/remotes/origin/$BASE"; then
      local_sha=$(git -C "$MAIN" rev-parse "$BASE")
      remote_sha=$(git -C "$MAIN" rev-parse "origin/$BASE")
      if [ "$local_sha" != "$remote_sha" ]; then
        if git -C "$MAIN" merge-base --is-ancestor "$BASE" "origin/$BASE"; then
          START="origin/$BASE"
          warn "local $BASE is behind origin/$BASE: branching from origin/$BASE (update the main clone with: git -C $MAIN pull --ff-only)"
        elif ! git -C "$MAIN" merge-base --is-ancestor "origin/$BASE" "$BASE"; then
          warn "local $BASE and origin/$BASE have diverged: branching from local $BASE"
        fi
      fi
    fi
  else
    warn "could not fetch origin (offline?): branching from local $BASE"
  fi
fi

# ── Worktree, junctions, restore ────────────────────────────────────────────
mkdir -p "$ROOT"
# LF line endings like the main clone (prettier --check expects LF); --no-track: the branch never follows main.
git -C "$MAIN" -c core.autocrlf=false worktree add --quiet --no-track -b "$BRANCH" "$WT" "$START"

linked=()
for package in "${NODE_PACKAGES[@]}"; do
  target="$MAIN/$package/node_modules"
  link="$WT/$package/node_modules"
  [ -d "$target" ] || continue
  [ -d "$WT/$package" ] || { warn "$package is not in the new branch: not linked"; continue; }
  [ ! -e "$link" ] || { warn "$link already exists: not linked"; continue; }
  make_junction "$link" "$target"
  linked+=("$package")
done

if [ "$RESTORE" = 1 ]; then
  if command -v dotnet >/dev/null 2>&1; then
    dotnet restore "$WT/code/api/Lotties.sln" --verbosity quiet >/dev/null || warn "dotnet restore failed: run it in the worktree"
  else
    warn "dotnet not found: run dotnet restore code/api/Lotties.sln in the worktree"
  fi
fi

cat <<EOF

Worktree ready: $WT
  branch  $BRANCH from $START ($(git -C "$WT" rev-parse --short HEAD))
  linked  ${linked[*]:-nothing} (node_modules of the main clone: never npm install / npm ci here)

Next:
  cd $WT
  work and commit on $BRANCH only (no dependency changes, no edits in the main clone)
  dev server on your slot's port (docs/PROCESS.md "Ports"): npm --prefix code/web run dev -- --port <port> --strictPort
  when done, from any checkout: scripts/worktree-integrate.sh $NAME
  afterwards:                   scripts/worktree-remove.sh $NAME --delete-branch
EOF
