# Starts mobile preview + prints access URLs. Run firewall script as Admin first for Wi-Fi access.
# Usage: .\scripts\start-mobile-preview.ps1

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$frontend = Join-Path $root 'frontend'

$lanIp = (
  Get-NetIPAddress -AddressFamily IPv4 |
  Where-Object { $_.IPAddress -like '192.168.*' -or $_.IPAddress -like '10.*' } |
  Select-Object -First 1 -ExpandProperty IPAddress
)

$preview = Get-NetTCPConnection -LocalPort 4173 -ErrorAction SilentlyContinue | Where-Object { $_.OwningProcess -gt 0 } | Select-Object -First 1
if (-not $preview) {
  Write-Host 'Starting preview on port 4173...'
  Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$frontend'; npm run preview:mobile"
  Start-Sleep -Seconds 5
} else {
  Write-Host 'Preview already running on port 4173.'
}

Write-Host ''
Write-Host 'Mobile access URLs:'
if ($lanIp) {
  Write-Host "  Wi-Fi:  http://${lanIp}:4173"
} else {
  Write-Host '  Wi-Fi:  http://YOUR-PC-IP:4173'
}
Write-Host '  HTTPS:  start cloudflared in another terminal:'
Write-Host '          npx cloudflared tunnel --url http://127.0.0.1:4173'
Write-Host ''
Write-Host 'If phone shows cannot reach server on Wi-Fi, run as Administrator:'
Write-Host "  .\scripts\allow-mobile-access.ps1"
