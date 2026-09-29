# Update to the latest version — Windows.
#
#   .\scripts\update.ps1
#
# git refuses to pull over local changes, and it is right to: it will not
# silently throw away work you might want. But "I edited package.json once and
# now updates are blocked" is a bad place to be stuck, so this sets the changes
# aside instead of discarding them, and tells you how to get them back.
#
# If Windows blocks the script:
#   Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass

[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'

function Write-Step($t) { Write-Host ""; Write-Host "==> " -ForegroundColor Blue -NoNewline; Write-Host $t -ForegroundColor White }
function Write-Ok($t)   { Write-Host "  [ok] " -ForegroundColor Green -NoNewline; Write-Host $t }
function Write-Warn($t) { Write-Host "  [!] " -ForegroundColor Yellow -NoNewline; Write-Host $t }
function Write-Info($t) { Write-Host "    $t" -ForegroundColor DarkGray }
function Stop-Update($t) { Write-Host ""; Write-Host "Update stopped. " -ForegroundColor Red -NoNewline; Write-Host $t; Write-Host ""; exit 1 }

$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Stop-Update "git is not installed." }
if (-not (Test-Path .git)) { Stop-Update "This isn't a git checkout, so there is nothing to update from." }

Write-Host "flashCards.io update" -ForegroundColor White

# Your cards, first. Nothing below touches data\ — it is gitignored, so pulling
# and rebuilding cannot see it. This copy exists so that is provable rather
# than something you have to take on faith.
Write-Step "Backing up your cards"
if (Test-Path data) {
    $snapshot = "data-backup-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
    Copy-Item -Recurse -Path data -Destination $snapshot
    Write-Ok "copied data\ to $snapshot\"
    Write-Info "Delete it once the update looks right."
} else {
    Write-Info "No data\ yet - nothing to back up."
}

Write-Step "Checking for local changes"
$stashed = $false
$dirty = git status --porcelain --untracked-files=no
if ($dirty) {
    Write-Warn "You have edits to tracked files:"
    git status --short --untracked-files=no | ForEach-Object { Write-Host "      $_" }
    git stash push --message "flashCards update $(Get-Date -Format 'yyyy-MM-dd HH:mm')" | Out-Null
    $stashed = $true
    Write-Ok "set aside with git stash - nothing was lost"
    Write-Info "Bring them back later with:  git stash pop"
} else {
    Write-Ok "none - pulling cleanly"
}

Write-Step "Fetching the latest version"
$before = (git rev-parse --short HEAD).Trim()
git pull --ff-only
if ($LASTEXITCODE -ne 0) { Stop-Update "Pull failed. Run 'git pull' yourself to see why." }
$after = (git rev-parse --short HEAD).Trim()

if ($before -eq $after) {
    Write-Ok "already up to date ($after)"
} else {
    Write-Ok "$before -> $after"
    git --no-pager log --oneline "$before..$after" | Select-Object -First 10 | ForEach-Object { Write-Host "      $_" }
}

Write-Step "Installing dependencies"
if (Test-Path package-lock.json) { npm ci --no-audit --no-fund } else { npm install --no-audit --no-fund }
if ($LASTEXITCODE -ne 0) { Stop-Update "Dependency installation failed." }
Write-Ok "done"

Write-Step "Building"
npm run build
if ($LASTEXITCODE -ne 0) { Stop-Update "Build failed." }
Write-Ok "done"

Write-Step "Ready"
Write-Host ""
Write-Host "  Start it with:  npm start" -ForegroundColor White
if ($stashed) {
    Write-Host ""
    Write-Host "  Your local edits are in the stash." -ForegroundColor Yellow
    Write-Host "  git stash list  to see them, git stash pop to restore."
    Write-Host "  If you did not mean to change anything, just leave them there." -ForegroundColor DarkGray
}
Write-Host ""
