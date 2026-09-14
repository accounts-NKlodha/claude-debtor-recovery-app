<#
.SYNOPSIS
  Logical (pg_dump-equivalent) backup of the linked Supabase production
  database, via the Supabase CLI -- no database password ever required or
  logged (see docs/disaster-recovery/index.md).

.DESCRIPTION
  Uses `supabase db dump --linked`, which runs pg_dump inside a Docker
  container using the CLI's own pre-authenticated access-token session
  (the same session `supabase link`/`db push` already use throughout this
  repo's history) -- never the raw database password. Requires Docker
  Desktop running locally.

  Safety:
    - Requires -ProjectRef to be passed explicitly and refuses to run if it
      does not match the currently linked project (`supabase status`),
      so a stale local link can never silently back up the wrong project.
    - Never prints or logs a database password/access token/service-role
      key -- none of those are inputs to this script at all.
    - Writes to .\backups\ (gitignored -- see .gitignore), one timestamped
      file per run; never overwrites a prior backup.
    - Fails loudly (non-zero exit, clear message) on any error: Docker not
      running, CLI not linked, dump command failing, or the output file
      being missing/empty.
    - Prints a SHA-256 checksum of the resulting file so its integrity can
      be verified later (e.g. after copying off-site).

.PARAMETER ProjectRef
  The Supabase project ref this backup is expected to target (e.g.
  "igagfxgzlojqrkaawnzx"). Required -- there is no default, so this script
  can never be run "blind" against whatever happens to be linked.

.EXAMPLE
  .\scripts\backup-database.ps1 -ProjectRef igagfxgzlojqrkaawnzx
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$ProjectRef,

    [string]$OutputDir = (Join-Path $PSScriptRoot "..\backups")
)

$ErrorActionPreference = "Stop"

function Fail($msg) {
    Write-Error $msg
    exit 1
}

# 1. Docker must be running -- `supabase db dump` runs pg_dump in a container.
try {
    docker info *> $null
    if ($LASTEXITCODE -ne 0) { throw "docker info exited $LASTEXITCODE" }
}
catch {
    Fail "Docker is not running. Start Docker Desktop, wait for it to be ready, then re-run this script. (supabase db dump requires Docker; no database password is used by this script either way.)"
}

# 2. Confirm the CLI is actually linked to the project we intend to back up
#    -- refuse to proceed on any mismatch, rather than silently dumping
#    whatever project happens to be linked locally. The linked project ref
#    is read directly from the CLI's own link-cache file (authoritative,
#    and avoids `supabase status`'s flag/output-format quirks across CLI
#    versions -- this file is exactly what `supabase db dump --linked`
#    itself reads to decide what to connect to).
$linkedRefPath = Join-Path $PSScriptRoot "..\supabase\.temp\project-ref"
if (-not (Test-Path $linkedRefPath)) {
    Fail "Could not find supabase/.temp/project-ref -- is this repo linked? Run 'npx supabase link --project-ref $ProjectRef' first."
}
$linkedRef = (Get-Content $linkedRefPath -Raw).Trim()
if ($linkedRef -ne $ProjectRef) {
    Fail "Linked project ref '$linkedRef' does not match the -ProjectRef you passed ('$ProjectRef'). Refusing to back up the wrong project. Run 'npx supabase link --project-ref $ProjectRef' if you meant to target it."
}

# 3. Prepare the output paths. Two files, applied in this order on
#    restore: `supabase db dump --linked` alone is SCHEMA-ONLY (confirmed
#    live -- 0 INSERT/COPY statements in a plain dump); `--data-only` is a
#    separate, explicit flag. A backup that can actually be restored and
#    verified (row counts, sample data) needs both.
if (-not (Test-Path $OutputDir)) {
    New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
}
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$schemaFile = Join-Path $OutputDir "debtrecover-$ProjectRef-$timestamp-schema.sql"
$dataFile = Join-Path $OutputDir "debtrecover-$ProjectRef-$timestamp-data.sql"

Write-Host "Backing up project $ProjectRef ..."
Write-Host "  Schema -> $schemaFile"
Write-Host "  Data   -> $dataFile"

# 4. Run both dumps. --linked uses the CLI's own access-token session; no
#    -Password/-DbUrl parameter exists on this script because none is
#    needed. Deliberately NOT redirecting stderr (no `2>&1`) -- PowerShell
#    5.1 wraps a native command's stderr lines in NativeCommandError
#    records when redirected, even on real success (the CLI writes routine
#    progress like "Initialising login role..." to stderr); stderr is
#    already visible in the console without redirection, and $LASTEXITCODE
#    below is the actual, reliable success signal.
npx supabase db dump --linked -f $schemaFile
if ($LASTEXITCODE -ne 0) {
    Fail "supabase db dump (schema) failed (exit $LASTEXITCODE). No partial file is trusted -- delete $schemaFile if it exists before retrying."
}
npx supabase db dump --linked --data-only -f $dataFile
if ($LASTEXITCODE -ne 0) {
    Fail "supabase db dump --data-only failed (exit $LASTEXITCODE). No partial file is trusted -- delete $dataFile if it exists before retrying."
}

# 5. Verify: both files exist and are non-empty. Never trust a silent success.
foreach ($f in @($schemaFile, $dataFile)) {
    if (-not (Test-Path $f)) {
        Fail "supabase db dump reported success but $f does not exist."
    }
    if ((Get-Item $f).Length -eq 0) {
        Fail "$f was created but is empty (0 bytes) -- treating this as a failed backup."
    }
}

# 6. Checksums, for later integrity verification (e.g. after an off-site copy).
$schemaHash = Get-FileHash -Path $schemaFile -Algorithm SHA256
$dataHash = Get-FileHash -Path $dataFile -Algorithm SHA256
$schemaSize = (Get-Item $schemaFile).Length
$dataSize = (Get-Item $dataFile).Length

Write-Host ""
Write-Host "Backup complete." -ForegroundColor Green
Write-Host "  Schema file: $schemaFile"
Write-Host "    Size:      $schemaSize bytes"
Write-Host "    SHA-256:   $($schemaHash.Hash)"
Write-Host "  Data file:   $dataFile"
Write-Host "    Size:      $dataSize bytes"
Write-Host "    SHA-256:   $($dataHash.Hash)"
Write-Host "  Timestamp:   $timestamp"
Write-Host ""
Write-Host "Both files are in .\backups\, which is gitignored -- they will never be committed."
Write-Host "Restore schema first, then data (see docs/disaster-recovery/index.md)."
Write-Host "Copy them off-site per the retention policy; do not leave the only copy on this machine."
