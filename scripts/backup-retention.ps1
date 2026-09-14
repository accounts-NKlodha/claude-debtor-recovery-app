<#
.SYNOPSIS
  Prunes .\backups\ down to the latest N daily backup sets. See
  docs/disaster-recovery/index.md for the retention policy this implements.

.DESCRIPTION
  A "backup set" is the trio of files one backup-database.ps1 run produces
  for one timestamp: *-schema.sql, *-data.sql, and *.sha256. This script
  only ever deletes a COMPLETE, checksum-verified set, and only once at
  least one newer valid set exists to take its place -- it will never
  delete the only backup present, and never deletes a set whose files
  don't match the checksums recorded in its own .sha256 file (a backup
  that fails its own checksum is left in place rather than silently
  removed, since that's exactly the situation an operator needs to notice).

  Monthly preservation is intentionally NOT automated here (kept simple
  per the disaster-recovery task's own guidance) -- see
  docs/disaster-recovery/index.md's retention section for the documented
  manual monthly-archive procedure (copy one verified set out of the
  pruning window, e.g. into backups\monthly-archive\, on/after the 1st of
  each month).

.PARAMETER BackupDir
  Directory containing backup sets. Defaults to ..\backups relative to
  this script (the same default backup-database.ps1 uses).

.PARAMETER KeepCount
  How many of the most recent valid daily backup sets to retain. Default 14.

.PARAMETER LogFile
  Where to append secret-free log lines. Defaults to backups\backup-log.txt
  (the same log backup-database.ps1 writes to, so one file shows the full
  backup+retention history).

.EXAMPLE
  .\scripts\backup-retention.ps1
#>
[CmdletBinding()]
param(
    [string]$BackupDir,
    [int]$KeepCount = 14,
    [string]$LogFile
)

$ErrorActionPreference = "Stop"

# See backup-database.ps1 for why these are resolved here rather than as
# param-block default values: $PSScriptRoot is not reliably populated
# during default-value evaluation under `powershell.exe -File`.
if (-not $PSBoundParameters.ContainsKey('BackupDir')) { $BackupDir = Join-Path $PSScriptRoot "..\backups" }
if (-not $PSBoundParameters.ContainsKey('LogFile')) { $LogFile = Join-Path $PSScriptRoot "..\backups\backup-log.txt" }

function Write-Log($msg) {
    $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $msg"
    Write-Host $line
    $logDir = Split-Path -Parent $LogFile
    if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }
    Add-Content -Path $LogFile -Value $line
}

if (-not (Test-Path $BackupDir)) {
    Write-Log "Retention: $BackupDir does not exist yet -- nothing to prune."
    exit 0
}

# 1. Discover backup sets by timestamp, extracted from the schema filename
#    (debtrecover-<ref>-<timestamp>-schema.sql). A set is only considered
#    "complete" (eligible for retention accounting at all) if all three
#    files exist for that timestamp.
$schemaFiles = Get-ChildItem -Path $BackupDir -Filter "debtrecover-*-schema.sql" -File
$sets = @()
foreach ($sf in $schemaFiles) {
    if ($sf.Name -notmatch '^(debtrecover-.+)-(\d{8}-\d{6})-schema\.sql$') { continue }
    $prefix = $Matches[1]
    $ts = $Matches[2]
    $dataFile = Join-Path $BackupDir "$prefix-$ts-data.sql"
    $checksumFile = Join-Path $BackupDir "$prefix-$ts.sha256"
    if (-not (Test-Path $dataFile) -or -not (Test-Path $checksumFile)) {
        Write-Log "Retention: skipping incomplete set for timestamp $ts (missing data file or checksum file) -- not pruning, not counting as valid."
        continue
    }

    # 2. Verify the set against its own recorded checksums before it is
    #    ever eligible for deletion (or even counted toward KeepCount) --
    #    a corrupt/tampered set must never be the reason a good older set
    #    gets pruned, and must never itself be silently deleted.
    $recorded = Get-Content $checksumFile
    $ok = $true
    foreach ($line in $recorded) {
        if ($line -notmatch '^([0-9a-fA-F]{64})\s+(.+)$') { $ok = $false; break }
        $expectedHash = $Matches[1].ToUpper()
        $fileName = $Matches[2].Trim()
        $filePath = Join-Path $BackupDir $fileName
        if (-not (Test-Path $filePath)) { $ok = $false; break }
        $actualHash = (Get-FileHash -Path $filePath -Algorithm SHA256).Hash
        if ($actualHash -ne $expectedHash) { $ok = $false; break }
    }
    if (-not $ok) {
        Write-Log "Retention: set for timestamp $ts FAILED checksum verification -- leaving in place, not counting as a valid retained backup, NOT deleting it either (never delete an unverified/failing set)."
        continue
    }

    $sets += [PSCustomObject]@{
        Timestamp = $ts
        SchemaFile = $sf.FullName
        DataFile = $dataFile
        ChecksumFile = $checksumFile
    }
}

if ($sets.Count -eq 0) {
    Write-Log "Retention: no complete, checksum-verified backup sets found -- nothing to prune."
    exit 0
}

# @() forces these to stay arrays even when exactly one element is present
# -- otherwise PowerShell unwraps a single-item pipeline result to a bare
# object, which silently loses .Count (reads as $null, not 0 or 1) and
# would make the log below misleading. Functionally harmless either way
# (Select-Object/-Skip/-First work fine on a scalar too), but an operator
# checking "did retention see my backups" deserves an accurate count.
$sorted = @($sets | Sort-Object Timestamp -Descending)
$toKeep = @($sorted | Select-Object -First $KeepCount)
$toPrune = @($sorted | Select-Object -Skip $KeepCount)

Write-Log "Retention: found $($sorted.Count) valid backup set(s); keeping the newest $([Math]::Min($KeepCount, $sorted.Count)); $($toPrune.Count) eligible for pruning."

# 3. Never prune down to zero -- if pruning would remove every remaining
#    backup (e.g. KeepCount is 0 or misconfigured), refuse rather than ever
#    leave zero backups on disk.
if ($toKeep.Count -eq 0) {
    Write-Log "Retention: refusing to run -- KeepCount ($KeepCount) would retain zero backups. No files deleted."
    exit 1
}

foreach ($set in $toPrune) {
    Write-Log "Retention: pruning verified backup set $($set.Timestamp) (newer valid sets already confirmed present)."
    Remove-Item -Path $set.SchemaFile, $set.DataFile, $set.ChecksumFile -Force
}

Write-Log "Retention complete. Retained $($toKeep.Count) backup set(s), pruned $($toPrune.Count)."
