<#
.SYNOPSIS
  Logical (pg_dump-equivalent) backup of the linked Supabase production
  database, via the Supabase CLI -- no database password ever required or
  logged (see docs/disaster-recovery/index.md).

.DESCRIPTION
  Uses `supabase db dump --linked`, which runs pg_dump inside a Docker
  container using the CLI's own pre-authenticated access-token session
  (the same session `supabase link`/`db push` already use throughout this
  repo's history, stored in Windows Credential Manager under "Supabase
  CLI:supabase" for the Windows user that ran `supabase login`) -- never
  the raw database password. Requires Docker Desktop running locally.
  Resolves the Supabase CLI from this repo's own devDependency
  (`node_modules/.bin/supabase` via `npx`), not a global/ad-hoc install --
  deterministic, no network install prompt possible during an unattended
  run.

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
    - Prints and writes to a log file a SHA-256 checksum of each resulting
      file so integrity can be verified later (e.g. after copying off-site).
    - Uses a named Mutex ("Global\DebtorRecovery-Backup-Database") around
      the whole run so two overlapping invocations (e.g. a manual run
      colliding with a scheduled one) cannot interleave writes or leave a
      half-written file behind; a second instance fails fast with a clear
      message instead of silently corrupting anything.
    - No interactive prompts on a normal successful run: CLI auth comes
      from the already-stored Credential Manager session (see above), the
      CLI binary comes from this repo's own devDependency (no npx install
      prompt), and every failure path exits non-zero instead of blocking.

.PARAMETER ProjectRef
  The Supabase project ref this backup is expected to target (e.g.
  "igagfxgzlojqrkaawnzx"). Required -- there is no default, so this script
  can never be run "blind" against whatever happens to be linked.

.PARAMETER LogFile
  Path to append structured, secret-free log lines to. Defaults to
  backups\backup-log.txt (gitignored, alongside the backups themselves).

.EXAMPLE
  .\scripts\backup-database.ps1 -ProjectRef igagfxgzlojqrkaawnzx
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$ProjectRef,

    [string]$OutputDir,

    [string]$LogFile
)

$ErrorActionPreference = "Stop"

# $PSScriptRoot is not reliably populated while parameter DEFAULT VALUES
# are being evaluated (confirmed live: empty under `powershell.exe -File`
# with a Mandatory parameter present, even though it is populated a moment
# later in the script body) -- so defaults that depend on it are resolved
# here instead, after the param block has finished binding.
if (-not $PSBoundParameters.ContainsKey('OutputDir')) { $OutputDir = Join-Path $PSScriptRoot "..\backups" }
if (-not $PSBoundParameters.ContainsKey('LogFile')) { $LogFile = Join-Path $PSScriptRoot "..\backups\backup-log.txt" }

function Write-Log($msg) {
    $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $msg"
    Write-Host $line
    $logDir = Split-Path -Parent $LogFile
    if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }
    Add-Content -Path $LogFile -Value $line
}

function Fail($msg) {
    Write-Log "FAILURE: $msg"
    # -ErrorAction Continue: print the message without letting the global
    # `$ErrorActionPreference = "Stop"` turn THIS Write-Error itself into a
    # terminating exception. Under Stop, an unqualified Write-Error here
    # would throw before ever reaching the exit 1 below -- harmless at the
    # very top level (an uncaught terminating error still yields a non-zero
    # process exit in this PowerShell version, confirmed), but the P1
    # backup-reliability fix wraps the rest of this script in a try/catch,
    # and a Fail() call from inside that try would have its Write-Error
    # caught by that same catch block, which calls Fail() again -- a
    # confusing double "FAILURE:" log entry for one real failure. Exiting
    # explicitly and deterministically here, rather than relying on
    # whatever PowerShell's own default uncaught-error handling happens to
    # do, is also simply the more correct way to guarantee "failure always
    # means a non-zero process exit" instead of an unwritten assumption.
    Write-Error $msg -ErrorAction Continue
    if ($mutexAcquired) { $mutex.ReleaseMutex() | Out-Null }
    exit 1
}

# 0. Acquire a cross-process lock so a second (e.g. manual) run started
#    while a scheduled run is still in progress cannot write to overlapping
#    output or interleave with the log file. A named Mutex is released
#    automatically by Windows even if this process is killed/crashes, so it
#    can never permanently wedge future runs.
$mutex = New-Object System.Threading.Mutex($false, "Global\DebtorRecovery-Backup-Database")
$mutexAcquired = $mutex.WaitOne([TimeSpan]::FromSeconds(5))
if (-not $mutexAcquired) {
    Write-Error "Another backup-database.ps1 run appears to be in progress (could not acquire the DebtorRecovery-Backup-Database lock within 5s). Refusing to run concurrently -- retry once the other run finishes."
    exit 1
}

Write-Log "Backup run starting for project $ProjectRef"

# P1 backup-reliability closure: everything from here to the normal exit 0
# is wrapped in one top-level try/catch. Every failure mode already named
# above (Docker down, CLI-link mismatch, dump failure, missing/empty
# output) already calls Fail() explicitly and so is unaffected by this
# wrapper. This outer catch exists for the failure modes that did NOT
# already have an explicit check -- checksum generation (Get-FileHash/
# Set-Content below) and any other genuinely unexpected error -- so that
# NO exception path can ever fall through to PowerShell's own default
# uncaught-error handling and risk an ambiguous/inconsistent process exit
# code. Every path out of this script must be an explicit Fail() (exit 1)
# or the explicit exit 0 at the very end; nothing is left to chance.
try {

# 1. Docker must be running -- `supabase db dump` runs pg_dump in a container.
#    Reliability fix (go-live review): the 19 Sept scheduled run failed simply
#    because Docker Desktop was not running at 23:30. If it is down, start
#    Docker Desktop and wait (up to 5 minutes) for the engine before failing.
function Test-DockerReady {
    try {
        docker info *> $null
        return ($LASTEXITCODE -eq 0)
    }
    catch { return $false }
}
if (-not (Test-DockerReady)) {
    $dockerExe = @(
        "C:\Program Files\Docker\Docker\Docker Desktop.exe",
        (Join-Path $env:LOCALAPPDATA "Programs\Docker\Docker\Docker Desktop.exe")
    ) | Where-Object { Test-Path $_ } | Select-Object -First 1
    if ($dockerExe) {
        Write-Log "Docker is not running -- starting Docker Desktop and waiting up to 5 minutes for the engine."
        Start-Process $dockerExe
        $deadline = (Get-Date).AddMinutes(5)
        while (-not (Test-DockerReady) -and (Get-Date) -lt $deadline) { Start-Sleep -Seconds 10 }
    }
}
if (-not (Test-DockerReady)) {
    Fail "Docker is not running and could not be started. Start Docker Desktop, wait for it to be ready, then re-run this script. (supabase db dump requires Docker; no database password is used by this script either way.)"
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
$checksumFile = Join-Path $OutputDir "debtrecover-$ProjectRef-$timestamp.sha256"

Write-Log "Backing up project $ProjectRef -> schema=$(Split-Path -Leaf $schemaFile) data=$(Split-Path -Leaf $dataFile)"

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

# 6. Checksums, for later integrity verification (e.g. after an off-site
#    copy) -- written to a sidecar .sha256 file next to the dumps (not just
#    printed), so a scheduled/unattended run leaves durable proof, and so
#    retention/off-site tooling can verify a backup before trusting it.
$schemaHash = Get-FileHash -Path $schemaFile -Algorithm SHA256
$dataHash = Get-FileHash -Path $dataFile -Algorithm SHA256
$schemaSize = (Get-Item $schemaFile).Length
$dataSize = (Get-Item $dataFile).Length

@(
    "$($schemaHash.Hash)  $(Split-Path -Leaf $schemaFile)"
    "$($dataHash.Hash)  $(Split-Path -Leaf $dataFile)"
) | Set-Content -Path $checksumFile -Encoding ascii

Write-Log "Backup complete. schema=$schemaSize bytes data=$dataSize bytes checksum_file=$(Split-Path -Leaf $checksumFile) sha256_schema=$($schemaHash.Hash) sha256_data=$($dataHash.Hash)"
Write-Host ""
Write-Host "Both files are in .\backups\, which is gitignored -- they will never be committed."
Write-Host "Restore schema first, then data (see docs/disaster-recovery/index.md)."
Write-Host "Copy them off-site per the retention policy; do not leave the only copy on this machine."

}
catch {
    # Catch-all safety net (see the comment above the opening `try`) -- the
    # exception message is logged for diagnosis but, like every other Fail()
    # call in this script, no credential/token/password is ever an input to
    # this script in the first place, so there is nothing secret to leak
    # here even in an unanticipated failure.
    Fail "Unexpected script failure: $($_.Exception.Message)"
}

$mutex.ReleaseMutex() | Out-Null
exit 0
