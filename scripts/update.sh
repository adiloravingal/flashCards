#!/usr/bin/env bash
#
# Update to the latest version — macOS and Linux.
#
#   ./scripts/update.sh
#
# git refuses to pull over local changes, and it is right to: it will not
# silently throw away work you might want. But "I edited package.json once and
# now updates are blocked" is a bad place to be stuck, so this sets the changes
# aside instead of discarding them, and tells you how to get them back.
#
# Windows: use scripts/update.ps1 instead.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [ -t 1 ]; then
  BOLD=$'\033[1m'; DIM=$'\033[2m'; RED=$'\033[31m'; GREEN=$'\033[32m'
  YELLOW=$'\033[33m'; BLUE=$'\033[34m'; RESET=$'\033[0m'
else
  BOLD=""; DIM=""; RED=""; GREEN=""; YELLOW=""; RESET=""; BLUE=""
fi
step() { printf "\n%s==>%s %s%s%s\n" "$BLUE" "$RESET" "$BOLD" "$1" "$RESET"; }
ok()   { printf "  %s✓%s %s\n" "$GREEN" "$RESET" "$1"; }
warn() { printf "  %s!%s %s\n" "$YELLOW" "$RESET" "$1"; }
info() { printf "    %s%s%s\n" "$DIM" "$1" "$RESET"; }
die()  { printf "\n%sUpdate stopped.%s %s\n\n" "$RED" "$RESET" "$1" >&2; exit 1; }

command -v git >/dev/null || die "git is not installed."
[ -d .git ] || die "This isn't a git checkout, so there is nothing to update from."

printf "%s\n" "${BOLD}flashCards.io update${RESET}"

# ---------------------------------------------------------------------------
# Your cards, first. Nothing below touches data/ — it is gitignored, so pulling
# and rebuilding cannot see it. This copy exists so that is provable rather
# than something you have to take on faith.
# ---------------------------------------------------------------------------
step "Backing up your cards"
if [ -d data ]; then
  SNAPSHOT="data-backup-$(date +%Y%m%d-%H%M%S)"
  cp -R data "$SNAPSHOT"
  ok "copied data/ to $SNAPSHOT/"
  info "Delete it once the update looks right."
else
  info "No data/ yet — nothing to back up."
fi

# ---------------------------------------------------------------------------
# Local code changes
# ---------------------------------------------------------------------------
step "Checking for local changes"
STASHED=0
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  warn "You have edits to tracked files:"
  git status --short --untracked-files=no | sed 's/^/      /'
  git stash push --message "flashCards update $(date +%Y-%m-%d\ %H:%M)" >/dev/null
  STASHED=1
  ok "set aside with git stash — nothing was lost"
  info "Bring them back later with:  git stash pop"
else
  ok "none — pulling cleanly"
fi

# ---------------------------------------------------------------------------
step "Fetching the latest version"
BEFORE="$(git rev-parse --short HEAD)"
git pull --ff-only || die "Pull failed. Run 'git pull' yourself to see why."
AFTER="$(git rev-parse --short HEAD)"

if [ "$BEFORE" = "$AFTER" ]; then
  ok "already up to date ($AFTER)"
else
  ok "$BEFORE → $AFTER"
  git --no-pager log --oneline "$BEFORE..$AFTER" | head -10 | sed 's/^/      /'
fi

step "Installing dependencies"
if [ -f package-lock.json ]; then npm ci --no-audit --no-fund; else npm install --no-audit --no-fund; fi
ok "done"

step "Building"
npm run build
ok "done"

step "Ready"
printf "\n  Start it with:  %snpm start%s\n" "$BOLD" "$RESET"
if [ "$STASHED" -eq 1 ]; then
  printf "\n  %sYour local edits are in the stash.%s\n" "$YELLOW" "$RESET"
  printf "  %sgit stash list%s  to see them, %sgit stash pop%s to restore.\n" "$BOLD" "$RESET" "$BOLD" "$RESET"
  printf "  %sIf you did not mean to change anything, just leave them there.%s\n" "$DIM" "$RESET"
fi
printf "\n"
