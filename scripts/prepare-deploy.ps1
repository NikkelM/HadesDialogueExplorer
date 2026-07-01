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

# Anchor to the repository root (this script lives in ``scripts/``) so the
# relative paths below (``generate_data.py``, ``outputs\*.json``) resolve the
# same way whether the script is invoked from the repo root or from inside
# ``scripts/``.
Set-Location (Split-Path $PSScriptRoot -Parent)

# Run a git command and abort if it fails. $ErrorActionPreference='Stop'
# does not catch native-command exit codes on Windows PowerShell 5.1, so
# the destructive git steps below (reset --hard, push --force) are routed
# through this guard to avoid continuing past a failure.
function Invoke-Git {
    param([Parameter(ValueFromRemainingArguments = $true)][string[]]$GitArgs)
    & git @GitArgs
    if ($LASTEXITCODE -ne 0) {
        Write-Error "git $($GitArgs -join ' ') failed (exit $LASTEXITCODE)."
        exit 1
    }
}

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

# Point the deploy branch at main and switch to it BEFORE generating outputs.
# ``checkout -B deploy main`` resets (or creates) deploy at main's commit;
# because that equals the current HEAD the working tree doesn't change, so the
# switch neither stalls on materialising the previous deploy commit (whose
# different file layout triggered interactive "delete this directory?" prompts)
# nor clobbers freshly extracted outputs. Generating *after* the switch keeps
# the (gitignored) outputs on the branch they're committed to - generating
# first on main and then resetting would delete them before they're staged.
Invoke-Git checkout -B deploy main

# Run extraction pipeline (now on the deploy branch)
Write-Host "Running extraction pipeline..."
python generate_data.py
if ($LASTEXITCODE -ne 0) {
    Invoke-Git checkout main
    Write-Error "Extraction pipeline failed."
    exit 1
}

$jsons = Get-ChildItem -Path outputs\*.json -ErrorAction SilentlyContinue
if (-not $jsons -or $jsons.Count -eq 0) {
    Invoke-Git checkout main
    Write-Error "No outputs/*.json files found after extraction."
    exit 1
}
Write-Host "Found $($jsons.Count) output files"

# Stage outputs (force-add despite gitignore)
Invoke-Git add --force outputs/*.json
Invoke-Git commit -m "Add extraction outputs for deployment"

if ($Dry) {
    Write-Host "[dry run] Would push deploy branch. Returning to main."
    Invoke-Git checkout main
    exit 0
}

Invoke-Git push --force origin deploy
Invoke-Git checkout main
Write-Host "Deploy branch pushed. The GitHub Pages workflow will build and deploy automatically."
