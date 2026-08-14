#!/usr/bin/env bash
#
# One-time setup for flashCards.io — macOS and Linux.
#
#   ./scripts/setup.sh              check, install dependencies, prepare data/
#   ./scripts/setup.sh --build      also produce a production build
#   ./scripts/setup.sh --yes        never prompt (for scripted installs)
#
# Windows: use scripts/setup.ps1 instead.

set -euo pipefail

# better-sqlite3 is the binding constraint: it requires Node 22+, which is
# stricter than Next's own >=20.9. Checking Next's number instead would let
# someone install on Node 20 and fail later with an opaque native-module error.
REQUIRED_NODE_MAJOR=22

ASSUME_YES=0
DO_BUILD=0

for arg in "$@"; do
  case "$arg" in
    --yes|-y) ASSUME_YES=1 ;;
    --build|-b) DO_BUILD=1 ;;
    --help|-h)
      sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) echo "Unknown option: $arg (try --help)" >&2; exit 2 ;;
  esac
done

# ---------------------------------------------------------------------------
# Output helpers. Colour only when writing to a terminal, so piping to a file
# or a CI log stays readable.
# ---------------------------------------------------------------------------
if [ -t 1 ]; then
  BOLD=$'\033[1m'; DIM=$'\033[2m'; RED=$'\033[31m'; GREEN=$'\033[32m'
  YELLOW=$'\033[33m'; BLUE=$'\033[34m'; RESET=$'\033[0m'
else
  BOLD=""; DIM=""; RED=""; GREEN=""; YELLOW=""; BLUE=""; RESET=""
fi

step()  { printf "\n%s==>%s %s%s%s\n" "$BLUE" "$RESET" "$BOLD" "$1" "$RESET"; }
ok()    { printf "  %s✓%s %s\n" "$GREEN" "$RESET" "$1"; }
warn()  { printf "  %s!%s %s\n" "$YELLOW" "$RESET" "$1"; }
fail()  { printf "  %s✗%s %s\n" "$RED" "$RESET" "$1"; }
info()  { printf "    %s%s%s\n" "$DIM" "$1" "$RESET"; }

die() {
  printf "\n%sSetup stopped.%s %s\n\n" "$RED" "$RESET" "$1" >&2
  exit 1
}

confirm() {
  [ "$ASSUME_YES" -eq 1 ] && return 0
  # No terminal to ask on (piped install, CI) — decline rather than hang.
  [ -t 0 ] || return 1
  printf "  %s?%s %s [y/N] " "$YELLOW" "$RESET" "$1"
  read -r reply
  [[ "$reply" =~ ^[Yy]$ ]]
}

# Run from the project root no matter where this was invoked from.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

printf "%s\n" "${BOLD}flashCards.io setup${RESET}"
printf "%s%s%s\n" "$DIM" "$ROOT" "$RESET"

# ---------------------------------------------------------------------------
# Platform
# ---------------------------------------------------------------------------
step "Checking your system"

OS="$(uname -s)"
ARCH="$(uname -m)"
case "$OS" in
  Darwin) PLATFORM="macOS" ;;
  Linux)  PLATFORM="Linux" ;;
  *) die "Unsupported system: $OS. This script covers macOS and Linux; use scripts/setup.ps1 on Windows." ;;
esac
ok "$PLATFORM ($ARCH)"

# ---------------------------------------------------------------------------
# Node
# ---------------------------------------------------------------------------
node_install_hint() {
  if [ "$PLATFORM" = "macOS" ]; then
    if command -v brew >/dev/null 2>&1; then
      echo "brew install node"
    else
      echo ""
    fi
  elif command -v apt-get >/dev/null 2>&1; then
    # Distro packages are routinely years behind; NodeSource is the supported
    # way to get a current major on Debian and Ubuntu.
    echo "curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs"
  elif command -v dnf >/dev/null 2>&1; then
    echo "sudo dnf install -y nodejs22"
  elif command -v pacman >/dev/null 2>&1; then
    echo "sudo pacman -S --noconfirm nodejs npm"
  elif command -v zypper >/dev/null 2>&1; then
    echo "sudo zypper install -y nodejs22"
  elif command -v apk >/dev/null 2>&1; then
    echo "sudo apk add nodejs npm"
  else
    echo ""
  fi
}

install_node() {
  local cmd
  cmd="$(node_install_hint)"

  if [ -z "$cmd" ]; then
    fail "No package manager I recognise."
    info "Install Node $REQUIRED_NODE_MAJOR or newer from https://nodejs.org/en/download"
    info "Then run this script again."
    die "Node is required."
  fi

  warn "Node $REQUIRED_NODE_MAJOR+ is needed. I can install it with:"
  info "$cmd"
  if confirm "Run that now?"; then
    bash -c "$cmd" || die "Node installation failed. Install it manually from https://nodejs.org"
    hash -r
  else
    info "No problem — run the command above yourself, then re-run this script."
    die "Node is required."
  fi
}

step "Checking Node.js"

if ! command -v node >/dev/null 2>&1; then
  fail "Node.js is not installed."
  install_node
fi

NODE_VERSION="$(node -v)"
NODE_MAJOR="$(echo "$NODE_VERSION" | sed 's/^v//' | cut -d. -f1)"

if [ "$NODE_MAJOR" -lt "$REQUIRED_NODE_MAJOR" ]; then
  fail "Node $NODE_VERSION is too old — this needs $REQUIRED_NODE_MAJOR or newer."
  info "better-sqlite3, which stores your cards, requires Node $REQUIRED_NODE_MAJOR+."
  install_node
  NODE_VERSION="$(node -v)"
  NODE_MAJOR="$(echo "$NODE_VERSION" | sed 's/^v//' | cut -d. -f1)"
  [ "$NODE_MAJOR" -lt "$REQUIRED_NODE_MAJOR" ] && die "Still on $NODE_VERSION. A shell restart may be needed."
fi
ok "Node $NODE_VERSION"

if ! command -v npm >/dev/null 2>&1; then
  fail "npm is missing (it normally ships with Node)."
  die "Reinstall Node from https://nodejs.org and try again."
fi
ok "npm $(npm -v)"

# ---------------------------------------------------------------------------
# Dependencies
# ---------------------------------------------------------------------------
step "Installing dependencies"

if [ -f package-lock.json ]; then
  info "npm ci — exact versions from package-lock.json"
  npm ci --no-audit --no-fund
else
  warn "No package-lock.json; resolving fresh versions."
  npm install --no-audit --no-fund
fi
ok "Dependencies installed"

# ---------------------------------------------------------------------------
# Native module. This is the one thing that can be installed yet not work, so
# it is checked explicitly rather than assumed.
# ---------------------------------------------------------------------------
step "Verifying the database engine"

if node -e "
  const Database = require('better-sqlite3');
  const db = new Database(':memory:');
  db.exec('CREATE TABLE t (a TEXT)');
  db.prepare('INSERT INTO t VALUES (?)').run('ok');
  if (db.prepare('SELECT a FROM t').get().a !== 'ok') process.exit(1);
  db.exec(\"CREATE VIRTUAL TABLE fts USING fts5(x)\");
  db.close();
" 2>/dev/null; then
  ok "better-sqlite3 works (with FTS5 for search)"
else
  fail "better-sqlite3 could not load."
  info "It ships prebuilt binaries for mainstream platforms, so this usually"
  info "means an unusual OS or CPU and it needs to compile from source."
  if [ "$PLATFORM" = "Linux" ]; then
    info "Install build tools, then re-run:  sudo apt-get install -y python3 make g++"
  else
    info "Install Xcode command line tools, then re-run:  xcode-select --install"
  fi
  die "The app cannot store cards without this."
fi

# ---------------------------------------------------------------------------
# Data directory and configuration
# ---------------------------------------------------------------------------
step "Preparing your data folder"

mkdir -p data/media
ok "data/ ready — your database, media and API key live here"
info "Back up this one folder and you have backed up everything."

if [ ! -f .env.local ] && [ -f .env.example ]; then
  cp .env.example .env.local
  ok "Created .env.local from the example"
  info "Every value in it is optional; defaults work fine."
else
  ok ".env.local already present — left untouched"
fi

# ---------------------------------------------------------------------------
# Optional production build
# ---------------------------------------------------------------------------
if [ "$DO_BUILD" -eq 1 ]; then
  step "Building for production"
  npm run build
  ok "Build complete"
fi

# ---------------------------------------------------------------------------
# Where to go next
# ---------------------------------------------------------------------------
lan_ip() {
  if [ "$PLATFORM" = "macOS" ]; then
    ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true
  else
    hostname -I 2>/dev/null | awk '{print $1}' || true
  fi
}

IP="$(lan_ip)"

step "Ready"
printf "\n  Start it:\n"
printf "    %snpm run dev%s      %sfor working on it%s\n" "$BOLD" "$RESET" "$DIM" "$RESET"
printf "    %snpm run build && npm start%s   %sfor everyday use%s\n" "$BOLD" "$RESET" "$DIM" "$RESET"
printf "\n  Then open:\n"
printf "    http://localhost:3939\n"
[ -n "$IP" ] && printf "    http://%s:3939   %s(from your phone or tablet, same network)%s\n" "$IP" "$DIM" "$RESET"

printf "\n  %sFirst run creates your API key at data/agent-key.txt%s\n" "$DIM" "$RESET"
printf "  %s(also shown in Settings — external AI agents need it)%s\n" "$DIM" "$RESET"

if [ -n "$IP" ]; then
  printf "\n  %sAnyone on your network can read and edit your cards.%s\n" "$YELLOW" "$RESET"
  printf "  %sSet FC_LOCK_UI=1 in .env.local to require the key once per device.%s\n" "$DIM" "$RESET"
fi
printf "\n"
