# Sync role permissions on an existing database (no demo data re-seed).
# Run from repo root: .\scripts\refresh-role-permissions.ps1

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location (Join-Path $root 'backend')
npm run db:refresh-roles
