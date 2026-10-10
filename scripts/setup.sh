#!/usr/bin/env bash
# XPlain: one-shot setup from sources (Linux / macOS / WSL).
#   - installs Node.js LTS via nvm into the user's home if node >= 20 is missing (no sudo)
#   - installs npm dependencies, builds the bundles and packages dist/xplain-<version>.vsix
# Usage: bash scripts/setup.sh [--no-package] [--install]
#   --no-package  skip creating the .vsix (dev only: npm run watch / F5)
#   --install     also install the .vsix into Cursor / VS Code (calls scripts/install.sh)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

MIN_NODE=20
NVM_VERSION="v0.40.3"
DO_PACKAGE=1
DO_INSTALL=0
for arg in "$@"; do
  case "$arg" in
    --no-package) DO_PACKAGE=0 ;;
    --install) DO_INSTALL=1 ;;
    -h|--help) sed -n '2,8p' "$0"; exit 0 ;;
  esac
done

log() { printf '\033[1;34m[xplain]\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m[xplain]\033[0m %s\n' "$*" >&2; exit 1; }

node_ok() {
  command -v node >/dev/null 2>&1 || return 1
  local major
  major="$(node -p 'process.versions.node.split(".")[0]')"
  [ "$major" -ge "$MIN_NODE" ]
}

load_nvm() {
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  # shellcheck disable=SC1091
  [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
}

ensure_node() {
  if node_ok; then
    log "node $(node --version) found"
    return
  fi
  load_nvm
  if command -v nvm >/dev/null 2>&1; then
    log "nvm found, installing Node LTS"
  else
    log "Node >= $MIN_NODE not found; installing nvm $NVM_VERSION into $HOME/.nvm (no sudo required)"
    command -v curl >/dev/null 2>&1 || command -v wget >/dev/null 2>&1 || die "curl or wget is required to download nvm"
    if command -v curl >/dev/null 2>&1; then
      curl -fsSL "https://raw.githubusercontent.com/nvm-sh/nvm/$NVM_VERSION/install.sh" | bash
    else
      wget -qO- "https://raw.githubusercontent.com/nvm-sh/nvm/$NVM_VERSION/install.sh" | bash
    fi
    load_nvm
  fi
  nvm install --lts >/dev/null
  nvm use --lts >/dev/null
  node_ok || die "Node installation failed"
  log "node $(node --version) ready (via nvm). Add this to your shell profile if missing:"
  log '  export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"'
}

ensure_node

log "installing dependencies"
if [ -f package-lock.json ]; then
  npm ci --no-audit --no-fund --ignore-scripts
else
  npm install --no-audit --no-fund --ignore-scripts
fi

log "building"
npm run build

if [ "$DO_PACKAGE" -eq 1 ]; then
  log "packaging .vsix"
  npm run package
  VSIX="$(ls -t dist/*.vsix | head -n1)"
  log "created $VSIX"
fi

if [ "$DO_INSTALL" -eq 1 ]; then
  bash "$ROOT/scripts/install.sh"
fi

log "done"
