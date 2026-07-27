# Rename project folder from "Amazon ERP" to "APEXCORE ERP"
# Close Cursor/IDE and stop dev servers before running.
$source = Join-Path $env:PUBLIC 'Amazon ERP'
$target = Join-Path $env:PUBLIC 'APEXCORE ERP'

if (-not (Test-Path $source)) {
  Write-Error "Source folder not found: $source"
  exit 1
}

if (Test-Path $target) {
  Write-Error "Target already exists: $target"
  exit 1
}

Rename-Item -Path $source -NewName 'APEXCORE ERP'
Write-Host "Renamed to: $target"
Write-Host "Re-open the project from: $target"
