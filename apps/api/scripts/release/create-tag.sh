#!/usr/bin/env bash
set -euo pipefail

# Usage:
#   VERSION=v0.1.0 ./scripts/release/create-tag.sh
#
# Creates an annotated tag and pushes it, triggering the ECR build workflow.

: "${VERSION:?VERSION is required (e.g., v0.1.0)}"

git fetch --tags
if git rev-parse "$VERSION" >/dev/null 2>&1; then
  echo "Tag $VERSION already exists locally. Aborting." >&2
  exit 1
fi

git tag -a "$VERSION" -m "Release $VERSION (send-only)"
git push origin "$VERSION"
echo "Tag pushed: $VERSION"


