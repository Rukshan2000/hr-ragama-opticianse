#!/usr/bin/env bash
# Run backend + frontend dev servers together. Ctrl+C stops both.
cd "$(dirname "$0")"
trap 'kill 0' EXIT
(cd main-backend && npm run dev) &
(cd main-frontend && npm run dev) &
wait
