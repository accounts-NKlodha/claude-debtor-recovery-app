<#
.SYNOPSIS
  Restores a schema+data backup (produced by backup-database.ps1) into the
  LOCAL Supabase dev stack (`supabase start`) -- never production. See
  docs/disaster-recovery/index.md.

.DESCRIPTION
  This script will ONLY target the local Supabase dev stack running in
  Docker (started via `npx supabase start` from this repo). It refuses to
  run against anything else -- there is no parameter that accepts a remote
  connection string or project ref, by design, so this script cannot be
  used to restore over production even by mistake.

  Restores schema first, then data (SET session_replication_role = replica
  around the data load, to safely bypass the self-referencing foreign key
  on case_hearings.rescheduled_from_id that `supabase db dump --data-only`
  itself warns about -- restoring already-validated data this way is safe;
  it is not a general-purpose constraint bypass left enabled afterward).

.PARAMETER SchemaFile
  Path to the *-schema.sql file. Required.

.PARAMETER DataFile
  Path to the *-data.sql file. Required.

.EXAMPLE
  .\scripts\restore-database.ps1 `
    -SchemaFile .\backups\debtrecover-igagfxgzlojqrkaawnzx-20260915-025315-schema.sql `
    -DataFile   .\backups\debtrecover-igagfxgzlojqrkaawnzx-20260915-025315-data.sql
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$SchemaFile,

    [Parameter(Mandatory = $true)]
    [string]$DataFile
)

$ErrorActionPreference = "Stop"

function Fail($msg) {
    Write-Error $msg
    exit 1
}

if (-not (Test-Path $SchemaFile)) { Fail "Schema file not found: $SchemaFile" }
if (-not (Test-Path $DataFile)) { Fail "Data file not found: $DataFile" }

# 1. Find the local Supabase Postgres container -- by the CLI's own project
#    label, never a hardcoded container name (which can vary by CLI
#    version). Refuses to proceed if it's not running: this script must
#    never fall back to guessing a different (possibly remote) target.
docker info *> $null
if ($LASTEXITCODE -ne 0) { Fail "Docker is not running." }

$container = (docker ps --filter "label=com.supabase.cli.project=debtrecover" --filter "name=supabase_db" --format "{{.Names}}" | Select-Object -First 1)
if (-not $container) {
    Fail "No running local Supabase Postgres container found (label com.supabase.cli.project=debtrecover, name matching supabase_db*). Run 'npx supabase start' first. Refusing to guess a target -- this script only ever restores into the local dev stack."
}
Write-Host "Restoring into LOCAL container: $container (never production -- this script has no remote-target parameter)"

# 2. `supabase start` already applied every migration + supabase/seed.sql
#    to this local stack on first init (that's how local dev normally
#    works) -- the target is NOT blank. A pg_dump schema file expects to
#    run against an empty database (it has no `DROP TABLE IF EXISTS`
#    guards), so `public` is dropped and recreated first. This only
#    touches the local disposable stack's `public` schema -- `auth` /
#    `storage` / `extensions` / `vault` (Supabase-platform-managed) are
#    left alone, and USAGE is re-granted to match Supabase's own default
#    local setup before the schema restore runs.
Write-Host "Resetting the local stack's public schema to a blank slate before restoring..."
docker exec $container psql -U postgres -d postgres -v ON_ERROR_STOP=1 -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role, postgres; GRANT ALL ON SCHEMA public TO postgres;"
if ($LASTEXITCODE -ne 0) { Fail "Failed to reset the local stack's public schema before restore." }

# 3. Copy both files into the container and restore schema first.
docker cp $SchemaFile "${container}:/tmp/restore-schema.sql"
if ($LASTEXITCODE -ne 0) { Fail "docker cp (schema) failed." }
docker cp $DataFile "${container}:/tmp/restore-data.sql"
if ($LASTEXITCODE -ne 0) { Fail "docker cp (data) failed." }

Write-Host "Applying schema..."
docker exec -e PGPASSWORD=postgres $container psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f /tmp/restore-schema.sql
if ($LASTEXITCODE -ne 0) { Fail "Schema restore failed (exit $LASTEXITCODE). See psql output above." }

Write-Host "Applying data (session_replication_role=replica during load, reset after)..."
docker exec $container sh -c "psql -U postgres -d postgres -v ON_ERROR_STOP=1 -c 'SET session_replication_role = replica;' -f /tmp/restore-data.sql -c 'SET session_replication_role = default;'"
if ($LASTEXITCODE -ne 0) { Fail "Data restore failed (exit $LASTEXITCODE). See psql output above." }

# 4. Clean up the copied files inside the container (they may contain
#    restored business data / auth rows -- no reason to leave them lying
#    around inside the container filesystem after a successful load).
docker exec $container rm -f /tmp/restore-schema.sql /tmp/restore-data.sql

Write-Host ""
Write-Host "Restore complete into the local dev stack." -ForegroundColor Green
Write-Host "Run the verification checks in docs/disaster-recovery/index.md next (table/row counts, RLS, security regression)."
