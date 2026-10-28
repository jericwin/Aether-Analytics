#!/usr/bin/env sh
# Start the API (with embedded worker) and the Vite dev server with hot reload.
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
(cd "$ROOT/apps/api" && uv run aether serve --reload) &
API_PID=$!
trap 'kill $API_PID' EXIT
cd "$ROOT/apps/web" && pnpm dev
