#!/usr/bin/env bash
# Thin shim around seed-demo.mjs so the script can be invoked with either
# `bash infra/seed-demo.sh` or `node infra/seed-demo.mjs`. Forwards env vars.
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec node "$DIR/seed-demo.mjs" "$@"
