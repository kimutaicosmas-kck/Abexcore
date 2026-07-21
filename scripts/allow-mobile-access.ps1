# Run PowerShell as Administrator, then:
#   Set-ExecutionPolicy -Scope Process Bypass -Force
#   .\scripts\allow-mobile-access.ps1

$rules = @(
  @{ Name = 'ApexCore ERP PWA Preview'; Port = 4173 },
  @{ Name = 'ApexCore ERP API'; Port = 3001 }
)

foreach ($r in $rules) {
  $existing = Get-NetFirewallRule -DisplayName $r.Name -ErrorAction SilentlyContinue
  if ($existing) {
    Write-Host "Already allowed: $($r.Name) (port $($r.Port))"
    continue
  }
  New-NetFirewallRule `
    -DisplayName $r.Name `
    -Direction Inbound `
    -Protocol TCP `
    -LocalPort $r.Port `
    -Action Allow `
    -Profile Private,Domain | Out-Null
  Write-Host "Allowed inbound port $($r.Port) - $($r.Name)"
}

$lanIp = (
  Get-NetIPAddress -AddressFamily IPv4 |
  Where-Object { $_.IPAddress -like '192.168.*' -or $_.IPAddress -like '10.*' } |
  Select-Object -First 1 -ExpandProperty IPAddress
)

Write-Host ""
if ($lanIp) {
  Write-Host "On your phone (same Wi-Fi), open: http://${lanIp}:4173"
} else {
  Write-Host "On your phone (same Wi-Fi), open: http://YOUR-PC-IP:4173"
}
