<#
.SYNOPSIS
  Registers (or updates) the "DebtorRecovery-Production-Backup" Windows
  Task Scheduler task, which runs backup-database.ps1 then
  backup-retention.ps1 daily. See docs/disaster-recovery/index.md.

.DESCRIPTION
  Deliberately does NOT run as SYSTEM and does NOT store a Windows account
  password. It registers the task to run as the CURRENT Windows user
  (whoever runs this installer), with logon type "InteractiveToken" --
  i.e. "Run only when user is logged on". This is a deliberate choice, not
  an oversight:

    The Supabase CLI's access-token session (used by backup-database.ps1
    for `supabase db dump --linked`, so no database password/token is ever
    an input to this script) is stored in Windows Credential Manager
    ("Supabase CLI:supabase"), scoped to the Windows user who ran
    `supabase login` -- confirmed via `cmdkey /list` during this task.
    Credential Manager entries like this are reliably readable by a task
    running in that user's own logged-on session (InteractiveToken).

    The alternative Task Scheduler mode -- "Run whether user is logged on
    or not" (logon type Password/S4U) -- requires Windows to store and
    unlock that user's Windows account password to load their profile
    non-interactively. That is a materially different, more sensitive
    security posture (a stored Windows password, requiring
    Task-Scheduler-prompted password entry and typically elevation to
    register), and is NOT configured by this script. If unattended
    execution while logged OFF is later required, that is a deliberate,
    separate decision for a human to make explicitly -- this script does
    not make it silently.

    Practically: this task will run its daily 23:30 backup as long as the
    registering Windows user is logged on (locked-screen is fine -- a
    locked session still counts as logged on for this purpose). On a
    single-operator machine left signed in overnight, this is sufficient;
    it is NOT sufficient if the machine is regularly shut down or signed
    out before 23:30.

  Runs with standard (not highest) privileges -- no UAC/elevation
  requested by the task itself. Registering a task that runs as yourself,
  with standard privileges, in "Run only when logged on" mode, normally
  does not require an elevated PowerShell session either -- but this
  script is intentionally NOT run automatically by anything else; a human
  runs it deliberately.

  No secret of any kind is passed as a task argument -- only the
  (non-secret) Supabase project ref and file paths.

.PARAMETER ProjectRef
  Supabase project ref to back up. Required, no default (same policy as
  backup-database.ps1 itself).

.PARAMETER TaskName
  Scheduled task name. Default: DebtorRecovery-Production-Backup.

.PARAMETER At
  Daily run time (24h "HH:mm"). Default: "23:30".

.EXAMPLE
  .\scripts\install-backup-task.ps1 -ProjectRef igagfxgzlojqrkaawnzx
#>
[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = "Medium")]
param(
    [Parameter(Mandatory = $true)]
    [string]$ProjectRef,

    [string]$TaskName = "DebtorRecovery-Production-Backup",

    [string]$At = "23:30"
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$backupScript = Join-Path $repoRoot "scripts\backup-database.ps1"
$retentionScript = Join-Path $repoRoot "scripts\backup-retention.ps1"

if (-not (Test-Path $backupScript)) { throw "Not found: $backupScript" }
if (-not (Test-Path $retentionScript)) { throw "Not found: $retentionScript" }

$currentUser = "$env:USERDOMAIN\$env:USERNAME"
Write-Host "This will register/update scheduled task '$TaskName' to run daily at $At"
Write-Host "as the current user ($currentUser), only while that user is logged on."
Write-Host "No password will be requested or stored by this script."
Write-Host ""

# Action 1: the backup itself. -NoProfile/-NonInteractive: never wait on a
# prompt. -ExecutionPolicy Bypass: scoped to this one process invocation
# only (does not change the machine/user execution policy). Working
# directory explicitly set to the repo root so relative resolution (e.g.
# `npx`, node_modules) behaves exactly as it does in an interactive shell
# run from the repo root.
$backupAction = New-ScheduledTaskAction `
    -Execute "powershell.exe" `
    -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$backupScript`" -ProjectRef $ProjectRef" `
    -WorkingDirectory "$repoRoot"

# Action 2: retention, run after the backup action (Task Scheduler runs a
# task's actions in the order listed). If the backup action failed, its
# non-zero exit does not stop the retention action from running -- that's
# fine, since backup-retention.ps1 only ever prunes checksum-verified
# complete sets and always keeps at least one, so it cannot compound a
# failed backup into data loss.
$retentionAction = New-ScheduledTaskAction `
    -Execute "powershell.exe" `
    -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$retentionScript`"" `
    -WorkingDirectory "$repoRoot"

$trigger = New-ScheduledTaskTrigger -Daily -At $At

# Run only when logged on (InteractiveToken) -- see .DESCRIPTION above for
# why this, not Password/S4U, and not SYSTEM.
$principal = New-ScheduledTaskPrincipal `
    -UserId $currentUser `
    -LogonType Interactive `
    -RunLevel Limited

$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -DontStopIfGoingOnBatteries `
    -DontStopOnIdleEnd `
    -MultipleInstances IgnoreNew `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 15) `
    -ExecutionTimeLimit (New-TimeSpan -Hours 2)

$task = New-ScheduledTask -Action @($backupAction, $retentionAction) -Trigger $trigger -Principal $principal -Settings $settings -Description "Daily production Supabase logical backup (schema+data) + retention pruning for Debtrecover. See docs/disaster-recovery/index.md. Runs as $currentUser while logged on; no secrets stored by this task."

if ($PSCmdlet.ShouldProcess($TaskName, "Register/update scheduled task")) {
    Register-ScheduledTask -TaskName $TaskName -InputObject $task -Force | Out-Null
    Write-Host "Task '$TaskName' registered." -ForegroundColor Green
    Write-Host "Verify with: Get-ScheduledTask -TaskName '$TaskName' | Get-ScheduledTaskInfo"
    Write-Host "Trigger a test run with: Start-ScheduledTask -TaskName '$TaskName'"
}
