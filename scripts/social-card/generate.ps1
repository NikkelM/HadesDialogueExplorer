# Regenerate the Hades Dialogue Explorer social share image (static/og-image.png).
#
# Two stages, both headless Chrome:
#   1. capture-panel.mjs screenshots the "Textline details" panel for one
#      dialogue (with a save loaded) -> panel.png, driven over the DevTools
#      Protocol so it can load the save and apply the card-only tweaks.
#   2. og-image.html (which embeds panel.png in a browser frame, styled to match
#      the nikkelm.dev site card) is rendered at 1200x630 -> static/og-image.png.
#
# Usage (from anywhere):
#   .\scripts\social-card\generate.ps1 -Save "C:\Users\me\Saved Games\Hades II\Profile3.sav"
#   .\scripts\social-card\generate.ps1 -Save <save> -Dialogue HecateFirstMeeting -Game hades2
#   .\scripts\social-card\generate.ps1 -Save <save> -SkipCapture   # only re-render the card
#
# Prerequisites:
#   - Google Chrome installed (or pass -Chrome <path>).
#   - Node >= 22 (built-in WebSocket).
#   - The built viewer served over HTTP at -BaseUrl (default http://localhost:8000);
#     run `py build_viewer.py` and serve dist/ first.
#   - Only needed for stage 1 (the panel capture); stage 2 is offline.

param(
    [Parameter(Mandatory = $true)][string]$Save,
    [string]$Dialogue = 'OdysseusBathHouse03',
    [string]$Game = 'hades2',
    [string]$BaseUrl = 'http://localhost:8000/',
    [string]$Chrome,
    [int]$CdpPort = 9222,
    [switch]$SkipCapture
)

$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
$repo = Split-Path (Split-Path $here -Parent) -Parent
$html = Join-Path $here 'og-image.html'
$panel = Join-Path $here 'panel.png'
$out = Join-Path $repo 'static\og-image.png'

if (-not $Chrome) {
    $Chrome = @(
        "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
        "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
        "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
    ) | Where-Object { Test-Path $_ } | Select-Object -First 1
}
if (-not $Chrome) { throw "Chrome not found - pass -Chrome <path to chrome.exe>." }

# --- stage 1: capture the panel screenshot over CDP ---
if (-not $SkipCapture) {
    if (-not (Test-Path $Save)) { throw "Save file not found: $Save" }
    $prof = Join-Path $env:TEMP 'hde-card-capture'
    Remove-Item $prof -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host "Launching Chrome (CDP :$CdpPort) for the panel capture..."
    $proc = Start-Process $Chrome -PassThru -ArgumentList @(
        '--headless=new', "--remote-debugging-port=$CdpPort", '--hide-scrollbars',
        '--force-device-scale-factor=2', "--user-data-dir=$prof", 'about:blank'
    )
    try {
        for ($i = 0; $i -lt 20; $i++) {
            Start-Sleep -Milliseconds 400
            try { Invoke-WebRequest "http://localhost:$CdpPort/json/version" -UseBasicParsing -TimeoutSec 2 | Out-Null; break } catch {}
        }
        Push-Location $here
        $env:CDP_PORT = "$CdpPort"
        node capture-panel.mjs $Dialogue $Save panel.png $BaseUrl $Game
        if ($LASTEXITCODE -ne 0) { throw "capture-panel.mjs failed ($LASTEXITCODE)" }
        Pop-Location
    }
    finally {
        Stop-Process -Id $proc.Id -ErrorAction SilentlyContinue
    }
}
if (-not (Test-Path $panel)) { throw "panel.png missing - run without -SkipCapture first." }

# --- stage 2: render the card HTML to the shipped PNG ---
$prof2 = Join-Path $env:TEMP 'hde-card-render'
Remove-Item $prof2 -Recurse -Force -ErrorAction SilentlyContinue
Write-Host "Rendering og-image.html -> static/og-image.png..."
& $Chrome '--headless=new' '--disable-gpu' '--window-size=1200,630' `
    '--allow-file-access-from-files' '--virtual-time-budget=3000' `
    "--user-data-dir=$prof2" "--screenshot=$out" "$html" | Out-Null

if (-not (Test-Path $out)) { throw "Render failed: $out not written." }
$kb = '{0:N1}' -f ((Get-Item $out).Length / 1KB)
Write-Host "Wrote $out ($kb KB). Rebuild with 'py build_viewer.py' to copy it into dist/."
