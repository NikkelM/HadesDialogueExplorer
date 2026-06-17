# Sync the deploy branch with main, run the extraction pipeline and
# viewer build, commit the outputs, and push to trigger the GitHub
# Pages deploy workflow.
#
# Usage:
#   .\scripts\prepare-deploy.ps1          # full deploy
#   .\scripts\prepare-deploy.ps1 -Dry     # show what would happen without pushing
#
# Prerequisites:
#   - Clean working tree on main (no uncommitted changes)
#   - Game script paths configured (config.toml / environment)

param([switch]$Dry)

$ErrorActionPreference = 'Stop'

$branch = git rev-parse --abbrev-ref HEAD
if ($branch -ne 'main') {
    Write-Error "Must be on main branch (currently on $branch)"
    exit 1
}

$dirty = git status --porcelain
if ($dirty) {
    Write-Error "Working tree is not clean. Commit or stash changes first."
    exit 1
}

# Run extraction pipeline
Write-Host "Running extraction pipeline..."
python generate_data.py
if ($LASTEXITCODE -ne 0) { Write-Error "Extraction pipeline failed."; exit 1 }

$jsons = Get-ChildItem -Path outputs\*.json -ErrorAction SilentlyContinue
if (-not $jsons -or $jsons.Count -eq 0) {
    Write-Error "No outputs/*.json files found after extraction."
    exit 1
}
Write-Host "Found $($jsons.Count) output files"

# Create or reset deploy branch to match main
if ((git show-ref --verify --quiet refs/heads/deploy 2>$null; $LASTEXITCODE) -eq 0) {
    git checkout deploy
    git reset --hard main
} else {
    git checkout -b deploy
}

# Stage outputs (force-add despite gitignore)
git add --force outputs/*.json
git commit -m "Add extraction outputs for deployment"

if ($Dry) {
    Write-Host "[dry run] Would push deploy branch. Returning to main."
    git checkout main
    exit 0
}

git push --force origin deploy
git checkout main
Write-Host "Deploy branch pushed. The GitHub Pages workflow will build and deploy automatically."
