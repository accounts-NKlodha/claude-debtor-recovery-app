#!/usr/bin/env bash
# Create an isolated worktree for a feature slice (using-git-worktrees).
# Usage: scripts/new-slice-worktree.sh <slice-name>
#   e.g. scripts/new-slice-worktree.sh m6-gst
set -euo pipefail
name="${1:?usage: new-slice-worktree.sh <slice-name>}"
branch="feat/${name}"
dir="../debtrecover-worktrees/${name}"
git worktree add -b "$branch" "$dir" HEAD
echo "worktree: $dir  (branch $branch)"
echo "next: cd \"$dir\" && npm install && npm run verify"
