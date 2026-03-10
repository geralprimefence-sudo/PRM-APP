#!/usr/bin/env bash
# Usage: GITHUB_TOKEN=ghp_xxx ./scripts/git_push_with_token.sh
set -euo pipefail

BRANCH=${1:-main}
REPO_ORG=${2:-}

if [ -z "$REPO_ORG" ]; then
  echo "Usage: GITHUB_TOKEN=... $0 [branch] <owner/repo>" >&2
  exit 2
fi

if [ -z "${GITHUB_TOKEN:-}" ]; then
  echo "Please set GITHUB_TOKEN environment variable with repo and package scopes." >&2
  exit 2
fi

REMOTE_URL="https://${GITHUB_TOKEN}@github.com/${REPO_ORG}.git"

git add -A
git commit -m "CI: add OCR Docker, CORS, API-key and deploy workflow" || true
git push "$REMOTE_URL" "HEAD:$BRANCH"

echo "Pushed to https://github.com/${REPO_ORG} (branch $BRANCH)"
