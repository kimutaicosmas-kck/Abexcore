# Daily MySQL backup helper — see DEPLOYMENT.md
param(
  [string]$OutputDir = ".\backups",
  [string]$DatabaseUrl = $env:DATABASE_URL
)

if (-not $DatabaseUrl) {
  Write-Error "Set DATABASE_URL or pass -DatabaseUrl"
  exit 1
}

New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$file = Join-Path $OutputDir "erp_backup_$timestamp.sql"

if (-not (Get-Command mysqldump -ErrorAction SilentlyContinue)) {
  Write-Host "mysqldump not in PATH. Example with Docker:"
  Write-Host '  docker compose exec mysql mysqldump -u erp_user -perp_password filter_erp > backup.sql'
  exit 1
}

# mysql://user:pass@host:port/db
$uri = [Uri]$DatabaseUrl.Replace('mysql://', 'http://')
$userInfo = $uri.UserInfo -split ':', 2
$user = $userInfo[0]
$pass = $userInfo[1]
$host = $uri.Host
$port = if ($uri.Port -gt 0) { $uri.Port } else { 3306 }
$db = $uri.AbsolutePath.TrimStart('/').Split('?')[0]

& mysqldump -h $host -P $port -u $user "-p$pass" $db | Set-Content -Encoding utf8 $file
Write-Host "Backup saved to $file"
