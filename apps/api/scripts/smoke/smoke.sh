#!/usr/bin/env bash
set -euo pipefail

# Usage:
#   BASE_URL="https://xxxx.sa-east-1.awsapprunner.com" RUN_TOKEN="optional" ./scripts/smoke/smoke.sh

: "${BASE_URL:?BASE_URL is required}"
RUN_TOKEN="${RUN_TOKEN:-}"

echo "GET /healthz"
curl -fsS "${BASE_URL%/}/healthz" -w "\n%{http_code}\n"

echo "GET /status"
curl -fsS "${BASE_URL%/}/status" -w "\n%{http_code}\n"

echo "POST /run"
if [ -n "$RUN_TOKEN" ]; then
  curl -fsS -X POST -H "x-run-token: $RUN_TOKEN" "${BASE_URL%/}/run" -w "\n%{http_code}\n"
else
  curl -fsS -X POST "${BASE_URL%/}/run" -w "\n%{http_code}\n"
fi

echo "Done."


