<#
.SYNOPSIS
  Task Scheduler entry point for the "DebtorRecovery-Production-Backup"
  task. Runs backup-database.ps1, then backup-retention.ps1, and exits
  with ONE process exit code that accurately reflects whether the backup
  itself succeeded. See docs/disaster-recovery/index.md.

.DESCRIPTION
  P1 backup-reliability closure. Root cause of the bug this closes: the
  scheduled task previously registered backup-database.ps1 and
  backup-retention.ps1 as TWO SEPARATE Task Scheduler actions. Windows
  Task Scheduler's "Last Run Result" for a multi-action task reflects only
  the exit code of the LAST action that ran -- not an aggregate of all of
  them. backup-retention.ps1 always exits 0 when it runs at all (it only
  ever prunes checksum-verified complete sets and always keeps at least
  one, so a failed same-day backup attempt doesn't itself make retention
  fail) -- so whenever the backup action failed (e.g. Docker not running)
  but retention still ran afterward, the task's own recorded result was
  always 0/success, silently masking the real failure. Confirmed live: a
  Docker-down run left `backup-log.txt` showing "FAILURE: Docker is not
  running" immediately followed by a normal "Retention complete" line, and
  Get-ScheduledTaskInfo's LastTaskResult was 0 for that same run.

  This script collapses both steps into ONE Task Scheduler action so the
  task has a single, unambiguous result:
    - Runs backup-database.ps1 as a genuine CHILD PROCESS (via
      `powershell.exe -File`, not the `&` call operator on the .ps1
      directly) so that its own internal `exit` statements terminate only
      that child process, not this wrapper -- letting this script inspect
      the child's real exit code afterward. (Invoking a .ps1 file in-process
      via `&` would instead have the child's `exit` terminate this whole
      wrapper's process too, which is exactly the class of subtlety this
      task's fix must not reintroduce.)
    - Preserves the existing, deliberate behavior that retention still
      runs even when the backup attempt failed (retention is independently
      safe -- see backup-retention.ps1's own header -- and keeps pruning
      old-but-valid sets working even during an extended outage).
    - Whichever step failed, ITS exit code is what this wrapper exits
      with; the backup's own failure always takes priority over (i.e. is
      never masked by) retention's separate result.
    - Logs which step(s) failed/succeeded via the same backup-log.txt
      convention the two scripts already use, so the log alone still
      tells the full story.

.PARAMETER ProjectRef
  Passed straight through to backup-database.ps1. Same "no default, must
  be explicit" policy as that script.

.EXAMPLE
  .\scripts\run-scheduled-backup.ps1 -ProjectRef igagfxgzlojqrkaawnzx
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$ProjectRef
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$backupScript = Join-Path $repoRoot "scripts\backup-database.ps1"
$retentionScript = Join-Path $repoRoot "scripts\backup-retention.ps1"
$logFile = Join-Path $repoRoot "backups\backup-log.txt"

function Write-WrapperLog($msg) {
    $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') [run-scheduled-backup] $msg"
    Write-Host $line
    $logDir = Split-Path -Parent $logFile
    if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }
    Add-Content -Path $logFile -Value $line
}

# Step 1: the backup itself, as a genuine child process (see .DESCRIPTION
# for why `powershell.exe -File`, not `&`, is required here).
& powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $backupScript -ProjectRef $ProjectRef
$backupExitCode = $LASTEXITCODE

# Step 2: retention, unconditionally -- same as before this fix, this is
# deliberate (see backup-retention.ps1's own header: it is always safe to
# run and never compounds a failed backup into data loss).
& powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $retentionScript
$retentionExitCode = $LASTEXITCODE

# The backup's own result always wins: a failed backup must make this
# whole run (and therefore the Task Scheduler task) report failure,
# regardless of what retention did afterward.
if ($backupExitCode -ne 0) {
    Write-WrapperLog "FAILURE: backup-database.ps1 exited $backupExitCode -- this scheduled run is a FAILURE regardless of retention's own result (retention exited $retentionExitCode). See the FAILURE line above in this same log for the actual reason."
    exit $backupExitCode
}

if ($retentionExitCode -ne 0) {
    Write-WrapperLog "FAILURE: backup-database.ps1 succeeded, but backup-retention.ps1 exited $retentionExitCode -- this scheduled run is a FAILURE."
    exit $retentionExitCode
}

Write-WrapperLog "SUCCESS: backup-database.ps1 and backup-retention.ps1 both completed successfully."
exit 0
