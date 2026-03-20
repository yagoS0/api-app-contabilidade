#!/usr/bin/env bash
set -euo pipefail

PARSER_PID=""
API_PID=""

cleanup() {
  if [[ -n "${API_PID}" ]]; then
    kill "${API_PID}" 2>/dev/null || true
  fi
  if [[ -n "${PARSER_PID}" ]]; then
    kill "${PARSER_PID}" 2>/dev/null || true
  fi
  wait 2>/dev/null || true
}

trap cleanup EXIT INT TERM

export PARSER_HOST="${PARSER_HOST:-127.0.0.1}"
export PARSER_PORT="${PARSER_PORT:-8787}"
export GUIDE_PARSER_URL="${GUIDE_PARSER_URL:-http://127.0.0.1:${PARSER_PORT}}"

python3 /app/python/parser/app.py &
PARSER_PID=$!

cd /app/apps/api
npm run start:prod &
API_PID=$!

wait -n "${PARSER_PID}" "${API_PID}"
STATUS=$?

cleanup
exit "${STATUS}"
