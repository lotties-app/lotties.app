#!/usr/bin/env bash
# Removes the git worktree of one feature (docs/PROCESS.md), its node_modules junctions first. Git Bash on Windows.
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/worktree-remove.sh <name> [--delete-branch] [--force-branch]

Removes the worktree of feature <name> (the one with branch feat/<name> checked out, else $WORKTREE_ROOT/<name>,
default E:/w/<name>), from any other checkout of the repository:
  1. removes its node_modules links first: each must be a reparse point (junction), and only the link itself is
     deleted ([System.IO.Directory]::Delete(path, $false)), never the main clone's node_modules it points at;
  2. refuses when another reparse point is left inside the worktree;
  3. git worktree remove --force, then git worktree prune.
Refuses a path that is not a registered worktree of this repository, the main clone, a locked worktree, and the
worktree the command runs in.

--delete-branch   also delete feat/<name> when it is merged into main (git branch -d)
--force-branch    delete feat/<name> even when it is not merged (git branch -D): its commits are lost
EOF
}

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=scripts/worktree-lib.sh
. "$SCRIPT_DIR/worktree-lib.sh"

NAME=''
DELETE_BRANCH=0
while [ $# -gt 0 ]; do
  case "$1" in
    -h | --help) usage; exit 0 ;;
    --delete-branch) [ "$DELETE_BRANCH" = 2 ] || DELETE_BRANCH=1; shift ;;
    --force-branch) DELETE_BRANCH=2; shift ;;
    -*) die "unknown option $1 (see --help)" ;;
    *) [ -z "$NAME" ] || die "one name only (see --help)"; NAME=$1; shift ;;
  esac
done
[ -n "$NAME" ] || { usage >&2; exit 2; }
[[ "$NAME" =~ ^[a-z0-9][a-z0-9-]{0,39}$ ]] || die "invalid name '$NAME'"

MAIN=$(main_root "$SCRIPT_DIR")
BRANCH="feat/$NAME"
WT=$(worktree_of_branch "$MAIN" "$BRANCH") || WT="${WORKTREE_ROOT:-E:/w}/$NAME"

remove_worktree() {
  # ── Guards ────────────────────────────────────────────────────────────────
  [ "$(norm_path "$WT")" != "$(norm_path "$MAIN")" ] || die "refusing to remove the main clone"
  if is_locked_worktree "$MAIN" "$WT"; then die "$WT is locked (an agent or a tool is using it): nothing removed"; fi
  case "$(norm_path "$PWD")/" in
    "$(norm_path "$WT")"/*) die "run this from another checkout, not from inside $WT" ;;
  esac

  if [ -d "$WT" ]; then
    # ── 1. The links, before anything else ──────────────────────────────────
    local package link left
    for package in "${NODE_PACKAGES[@]}"; do
      link="$WT/$package/node_modules"
      [ -e "$link" ] || [ -L "$link" ] || continue
      if is_reparse_point "$link"; then
        remove_link "$link"
        info "removed link $package/node_modules"
      else
        warn "$package/node_modules is a real folder of the worktree (npm install was run there?): deleted with the worktree"
      fi
    done

    # ── 2. Nothing else may point outside the worktree ──────────────────────
    left=$(reparse_points_under "$WT")
    [ -z "$left" ] || die "reparse points left in $WT (remove them by hand first; nothing removed):"$'\n'"$left"

    # ── 3. The worktree ─────────────────────────────────────────────────────
    git -C "$MAIN" worktree remove --force "$WT"
  else
    warn "$WT is already gone: pruning its registration"
  fi
  git -C "$MAIN" worktree prune
  info "removed worktree $WT"
}

if is_secondary_worktree "$MAIN" "$WT"; then
  remove_worktree
elif [ ! -e "$WT" ] && [ "$DELETE_BRANCH" != 0 ] && git -C "$MAIN" show-ref --verify --quiet "refs/heads/$BRANCH"; then
  info "no worktree for $NAME (already removed): only the branch is handled"
else
  die "$WT is not a registered worktree of $MAIN (nothing removed)"
fi

if [ "$DELETE_BRANCH" != 0 ] && git -C "$MAIN" show-ref --verify --quiet "refs/heads/$BRANCH"; then
  if [ "$DELETE_BRANCH" = 2 ]; then
    git -C "$MAIN" branch -D "$BRANCH"
  elif git -C "$MAIN" merge-base --is-ancestor "$BRANCH" main; then
    git -C "$MAIN" branch -d "$BRANCH"
  else
    warn "$BRANCH is not merged into main: kept (use --force-branch to delete it anyway)"
  fi
fi

info ''
git -C "$MAIN" worktree list
