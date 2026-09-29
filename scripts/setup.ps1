# One-time setup for flashCards.io - Windows.
#
#   .\scripts\setup.ps1              check, install dependencies, prepare data\
#   .\scripts\setup.ps1 -Build       also produce a production build
#   .\scripts\setup.ps1 -Yes         never prompt (for scripted installs)
#
# If Windows blocks the script, allow it for this session only:
#   Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
#
# macOS and Linux: use scripts/setup.sh instead.

[CmdletBinding()]
param(
    [switch]$Build,
    [switch]$Yes
)

$ErrorActionPreference = 'Stop'

# better-sqlite3 is the binding constraint: it needs Node 22+, stricter than
# Next's own >=20.9. Checking Next's number instead would let setup "succeed"
# and then fail later with an opaque native-module error.
$RequiredNodeMajor = 22

# ASCII markers only. Windows PowerShell 5.1 is still the default on many
# machines and reads script files as ANSI, which turns tick and cross glyphs
# into mojibake. Colour carries the meaning instead.
function Write-Step($text) { Write-Host ""; Write-Host "==> " -ForegroundColor Blue -NoNewline; Write-Host $text -ForegroundColor White }
function Write-Ok($text)   { Write-Host "  [ok]   " -ForegroundColor Green -NoNewline;  Write-Host $text }
function Write-Warn($text) { Write-Host "  [note] " -ForegroundColor Yellow -NoNewline; Write-Host $text }
function Write-Fail($text) { Write-Host "  [fail] " -ForegroundColor Red -NoNewline;    Write-Host $text }
function Write-Info($text) { Write-Host "         $text" -ForegroundColor DarkGray }

function Stop-Setup($text) {
    Write-Host ""
    Write-Host "Setup stopped. " -ForegroundColor Red -NoNewline
    Write-Host $text
    Write-Host ""
    exit 1
}

function Confirm-Action($question) {
    if ($Yes) { return $true }
    $reply = Read-Host "  ? $question [y/N]"
    return $reply -match '^[Yy]$'
}

# Run from the project root regardless of where this was invoked from.
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

Write-Host "flashCards.io setup" -ForegroundColor White
Write-Host $Root -ForegroundColor DarkGray

# ---------------------------------------------------------------------------
# Platform
# ---------------------------------------------------------------------------
Write-Step "Checking your system"
$arch = $env:PROCESSOR_ARCHITECTURE
Write-Ok "Windows ($arch)"

# ---------------------------------------------------------------------------
# Node
# ---------------------------------------------------------------------------
function Install-Node {
    if (Get-Command winget -ErrorAction SilentlyContinue) {
        Write-Warn "Node $RequiredNodeMajor+ is needed. I can install it with:"
        Write-Info "winget install OpenJS.NodeJS.LTS"
        if (Confirm-Action "Run that now?") {
            winget install --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
            if ($LASTEXITCODE -ne 0) { Stop-Setup "Node installation failed. Install it from https://nodejs.org" }
            Write-Warn "Close this terminal and open a new one so PATH updates, then re-run this script."
            exit 0
        }
        Write-Info "No problem - run the command above yourself, then re-run this script."
        Stop-Setup "Node is required."
    }

    Write-Fail "winget is not available."
    Write-Info "Install Node $RequiredNodeMajor or newer from https://nodejs.org/en/download"
    Write-Info "Then run this script again."
    Stop-Setup "Node is required."
}

Write-Step "Checking Node.js"

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Fail "Node.js is not installed."
    Install-Node
}

$nodeVersion = (node -v)
# Split into its own statement: `[int](...)[0]` is ambiguous to the parser,
# which will try to index the cast result rather than the array.
$nodeParts = ($nodeVersion -replace '^v', '') -split '\.'
$nodeMajor = [int]$nodeParts[0]

if ($nodeMajor -lt $RequiredNodeMajor) {
    Write-Fail "Node $nodeVersion is too old - this needs $RequiredNodeMajor or newer."
    Write-Info "better-sqlite3, which stores your cards, requires Node $RequiredNodeMajor+."
    Install-Node
}
Write-Ok "Node $nodeVersion"

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Write-Fail "npm is missing (it normally ships with Node)."
    Stop-Setup "Reinstall Node from https://nodejs.org and try again."
}
Write-Ok "npm $(npm -v)"

# ---------------------------------------------------------------------------
# Dependencies
# ---------------------------------------------------------------------------
Write-Step "Installing dependencies"

if (Test-Path package-lock.json) {
    Write-Info "npm ci - exact versions from package-lock.json"
    npm ci --no-audit --no-fund
} else {
    Write-Warn "No package-lock.json; resolving fresh versions."
    npm install --no-audit --no-fund
}
if ($LASTEXITCODE -ne 0) { Stop-Setup "Dependency installation failed." }
Write-Ok "Dependencies installed"

# ---------------------------------------------------------------------------
# Native module - the one thing that can install yet not work.
# ---------------------------------------------------------------------------
Write-Step "Verifying the database engine"

$probe = @'
const Database = require('better-sqlite3');
const db = new Database(':memory:');
db.exec('CREATE TABLE t (a TEXT)');
db.prepare('INSERT INTO t VALUES (?)').run('ok');
if (db.prepare('SELECT a FROM t').get().a !== 'ok') process.exit(1);
db.exec("CREATE VIRTUAL TABLE fts USING fts5(x)");
db.close();
'@

# Two things matter about where this file goes.
#
# The extension must be .cjs: package.json declares "type": "module", so a
# plain .js here is treated as an ES module and `require` throws.
#
# And it must sit in the project, not in TEMP. Node resolves modules relative
# to the file, so from a temp directory `require('better-sqlite3')` finds
# nothing at all.
$probeFile = Join-Path $Root ".fc-sqlite-probe.cjs"
Set-Content -Path $probeFile -Value $probe -Encoding ASCII
node $probeFile 2>$null
$probeOk = ($LASTEXITCODE -eq 0)
Remove-Item $probeFile -ErrorAction SilentlyContinue

if ($probeOk) {
    Write-Ok "better-sqlite3 works (with FTS5 for search)"
} else {
    Write-Fail "better-sqlite3 could not load."
    Write-Info "It ships prebuilt binaries for mainstream platforms, so this usually"
    Write-Info "means an unusual CPU and it needs to compile from source."
    Write-Info "Install the build tools, then re-run:"
    Write-Info "  winget install Microsoft.VisualStudio.2022.BuildTools"
    Stop-Setup "The app cannot store cards without this."
}

# ---------------------------------------------------------------------------
# Data directory and configuration
# ---------------------------------------------------------------------------
Write-Step "Preparing your data folder"

New-Item -ItemType Directory -Force -Path "data\media" | Out-Null
Write-Ok "data\ ready - your database, media and API key live here"
Write-Info "Back up this one folder and you have backed up everything."

if ((-not (Test-Path .env.local)) -and (Test-Path .env.example)) {
    Copy-Item .env.example .env.local
    Write-Ok "Created .env.local from the example"
    Write-Info "Every value in it is optional; defaults work fine."
} else {
    Write-Ok ".env.local already present - left untouched"
}

# ---------------------------------------------------------------------------
# Optional production build
# ---------------------------------------------------------------------------
if ($Build) {
    Write-Step "Building for production"
    npm run build
    if ($LASTEXITCODE -ne 0) { Stop-Setup "Build failed." }
    Write-Ok "Build complete"
}

# ---------------------------------------------------------------------------
# Where to go next
# ---------------------------------------------------------------------------
$ip = $null
try {
    $ip = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop |
        Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } |
        Select-Object -First 1).IPAddress
} catch { $ip = $null }

Write-Step "Ready"
Write-Host ""
Write-Host "  Start it:"
Write-Host "    npm run build; npm start" -ForegroundColor White -NoNewline
Write-Host "   for everyday use" -ForegroundColor DarkGray
Write-Host "    npm run dev" -ForegroundColor White -NoNewline
Write-Host "      for working on it" -ForegroundColor DarkGray
Write-Host ""
Write-Host "  Then open:"
Write-Host "    http://localhost:3939" -NoNewline
Write-Host "   (npm start)" -ForegroundColor DarkGray
Write-Host "    http://localhost:3000" -NoNewline
Write-Host "   (npm run dev)" -ForegroundColor DarkGray
if ($ip) {
    Write-Host "    http://${ip}:3939" -NoNewline
    Write-Host "   (from your phone or tablet, same network)" -ForegroundColor DarkGray
}

Write-Host ""
Write-Host "  First run creates your API key at data\agent-key.txt" -ForegroundColor DarkGray
Write-Host "  (also shown in Settings - external AI agents need it)" -ForegroundColor DarkGray

if ($ip) {
    Write-Host ""
    Write-Host "  Anyone on your network can read and edit your cards." -ForegroundColor Yellow
    Write-Host "  Set FC_LOCK_UI=1 in .env.local to require the key once per device." -ForegroundColor DarkGray
}
Write-Host ""
