# Writes a fresh synthetic demo backup (a month of invented events for a made-up baby, ending now, one running sleep) for the Alexa
# reviewers' demo account (docs/ALEXA-SUBMISSION.md step 2). Run it as many times as needed, right before importing the file.
# Usage: scripts\generate-demo-backup.ps1 [-Out <file>]   (default docs\samples\lotties-demo-backup-lia.json, gitignored)
param([string]$Out)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
if (-not $Out) { $Out = Join-Path $root 'docs\samples\lotties-demo-backup-lia.json' }
New-Item -ItemType Directory -Force (Split-Path -Parent $Out) | Out-Null
$env:LOTTIES_DEMO_BACKUP_OUT = $Out
try {
  dotnet test (Join-Path $root 'code\api\tests\Lotties.Api.Tests') --filter DemoBackupGenerator --nologo -v q
  if ($LASTEXITCODE -ne 0) { throw "dotnet test failed ($LASTEXITCODE)" }
} finally { Remove-Item Env:LOTTIES_DEMO_BACKUP_OUT -ErrorAction SilentlyContinue }
Write-Host "Demo backup written: $Out"
Write-Host 'Next: delete the demo baby in the demo account (Hub > Settings > Baby), then Hub > Import backup with this file.'
