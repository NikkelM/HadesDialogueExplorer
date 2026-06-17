#!/usr/bin/env bash
# Sync the deploy branch with main and commit the current outputs/*.json
# files so the GitHub Pages workflow can build and deploy the viewer.
#
# Usage:
#   ./scripts/prepare-deploy.sh          # creates/updates deploy branch and pushes
#   ./scripts/prepare-deploy.sh --dry    # show what would happen without pushing
#
# Prerequisites:
#   - Clean working tree on main (no uncommitted changes)
#   - outputs/*.json populated by the extraction pipeline

set -euo pipefail

DRY=false
if [[ "${1:-}" == "--dry" ]]; then
    DRY=true
fi

OUTPUTS_DIR="outputs"
JSON_COUNT=$(find "$OUTPUTS_DIR" -maxdepth 1 -name '*.json' | wc -l)
if [ "$JSON_COUNT" -eq 0 ]; then
    echo "Error: no $OUTPUTS_DIR/*.json files found. Run the extraction pipeline first." >&2
    exit 1
fi
echo "Found $JSON_COUNT output files"

CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$CURRENT_BRANCH" != "main" ]; then
    echo "Error: must be on main branch (currently on $CURRENT_BRANCH)" >&2
    exit 1
fi

if ! git diff --quiet || ! git diff --cached --quiet; then
    echo "Error: working tree is not clean. Commit or stash changes first." >&2
    exit 1
fi

# Create or reset deploy branch to match main
if git show-ref --verify --quiet refs/heads/deploy; then
    git checkout deploy
    git reset --hard main
else
    git checkout -b deploy
fi

# Stage outputs (force-add despite gitignore)
git add --force "$OUTPUTS_DIR"/*.json
git commit -m "Add extraction outputs for deployment"

if [ "$DRY" = true ]; then
    echo "[dry run] Would push deploy branch. Returning to main."
    git checkout main
    exit 0
fi

git push --force origin deploy
git checkout main
echo "Deploy branch pushed. The GitHub Pages workflow will build and deploy automatically."
