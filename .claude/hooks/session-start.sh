#!/bin/bash
# SessionStart hook for Claude Code on the web.
# Installs the Chrome extension's dependencies so tests, typecheck, lint and
# build work in cloud sessions. Idempotent and non-interactive.
set -euo pipefail

ROOT="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
EXT_DIR="$ROOT/extension"

if [ ! -d "$EXT_DIR" ]; then
  echo "session-start: extension/ not found, nothing to install."
  exit 0
fi

cd "$EXT_DIR"

# Install only when needed — the container image is cached after the hook
# completes, so a populated node_modules persists across sessions.
if [ ! -d node_modules ] || [ package-lock.json -nt node_modules ]; then
  echo "session-start: installing extension dependencies (npm install)…"
  npm install --no-audit --no-fund
else
  echo "session-start: extension dependencies already present, skipping install."
fi

echo "session-start: ready. cd extension && npm test | npm run build | npm run lint"
