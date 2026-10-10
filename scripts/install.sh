#!/usr/bin/env bash
# XPlain: install the packaged .vsix into Cursor / VS Code (local or Remote-SSH server side).
# Usage: bash scripts/install.sh [path/to/xplain.vsix] [--cli <cursor|code|path>]
# Detection order: cursor, code, cursor-server (~/.cursor-server), code-server (~/.vscode-server).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

log() { printf '\033[1;34m[xplain]\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m[xplain]\033[0m %s\n' "$*" >&2; exit 1; }

VSIX=""
CLI=""
while [ $# -gt 0 ]; do
  case "$1" in
    --cli) CLI="$2"; shift 2 ;;
    -h|--help) sed -n '2,4p' "$0"; exit 0 ;;
    *) VSIX="$1"; shift ;;
  esac
done

if [ -z "$VSIX" ]; then
  VSIX="$(ls -t dist/*.vsix 2>/dev/null | head -n1 || true)"
  [ -n "$VSIX" ] || die "no .vsix found in dist/. Run: bash scripts/setup.sh"
fi
[ -f "$VSIX" ] || die "file not found: $VSIX"
# Server CLIs resolve relative paths against their own cwd: make it absolute.
VSIX="$(cd "$(dirname "$VSIX")" && pwd)/$(basename "$VSIX")"

# Collect candidate CLIs. Server-side CLIs are needed when the workspace is
# opened through Remote-SSH: the extension (extensionKind: workspace) must be
# installed on the remote machine.
candidates=()
if [ -n "$CLI" ]; then
  candidates+=("$CLI")
else
  for c in cursor code code-insiders; do
    command -v "$c" >/dev/null 2>&1 && candidates+=("$c")
  done
  # Newest cursor-server / vscode-server first.
  while IFS= read -r s; do candidates+=("$s"); done < <(ls -t "$HOME"/.cursor-server/bin/*/*/bin/cursor-server "$HOME"/.cursor-server/bin/*/bin/cursor-server 2>/dev/null || true)
  while IFS= read -r s; do candidates+=("$s"); done < <(ls -t "$HOME"/.vscode-server/bin/*/bin/code-server "$HOME"/.vscode-server/cli/servers/*/server/bin/code-server 2>/dev/null || true)
fi

[ "${#candidates[@]}" -gt 0 ] || die "no Cursor/VS Code CLI found. Install manually: Extensions view -> '...' -> Install from VSIX -> $VSIX"

installed=0
seen_servers=0
seen_keys=""
for c in "${candidates[@]}"; do
  # Deduplicate: `cursor`/`code` on a Remote-SSH host are the server's remote-cli,
  # i.e. the same installation as cursor-server. Key by the server build folder.
  real="$(command -v "$c" 2>/dev/null || echo "$c")"
  real="$(readlink -f "$real" 2>/dev/null || echo "$real")"
  key="$real"
  case "$real" in
    *-server/bin/*)
      key="$(printf '%s' "$real" | sed -E 's#(.*-server/bin/([^/]+/)?[0-9a-f]{40}).*#\1#')"
      seen_servers=1
      ;;
  esac
  if printf '%s\n' "$seen_keys" | grep -qxF "$key"; then continue; fi
  seen_keys="$seen_keys
$key"
  log "installing into: $c"
  if "$c" --install-extension "$VSIX" --force; then
    installed=1
  else
    log "failed for $c (continuing)"
  fi
done

[ "$installed" -eq 1 ] || die "installation failed for every CLI candidate"
log "installed. Reload the window (Developer: Reload Window) to activate XPlain."
[ "$seen_servers" -eq 1 ] && log "note: for Remote-SSH the extension was installed on the server side (this machine)."
exit 0
